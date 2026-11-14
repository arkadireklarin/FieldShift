"use client";

import { divIcon, type Map as LeafletMap } from "leaflet";
import { useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  TileLayer,
  ZoomControl,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { SERVICE_REGIONS } from "@/lib/regions";
import type { Coordinates } from "@/types/api";
import styles from "./field-map.module.css";

interface FieldMapProps {
  location: Coordinates;
  onSelect: (location: Coordinates) => void;
  polygon: Coordinates[];
  onPolygonChange: (polygon: Coordinates[]) => void;
}

const MAP_LAYERS = {
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: '<a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9">Esri</a>, Vantor, Earthstar Geographics, GIS User Community',
  },
  street: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  },
};
const FIELD_ZOOM = 14;
const MAX_VERTICES = 20;
const FIELD_POINT = divIcon({
  className: styles.pin,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function MapClicks({ onClick }: { onClick: (point: Coordinates) => void }) {
  useMapEvents({
    click(event) {
      const { lat, lng } = event.latlng;
      onClick({ lat, lon: lng });
    },
  });
  return null;
}

function crossProduct(a: Coordinates, b: Coordinates, c: Coordinates) {
  return (b.lon - a.lon) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lon - a.lon);
}

function edgesIntersect(a: Coordinates, b: Coordinates, c: Coordinates, d: Coordinates) {
  const overlap = (start: number, end: number, otherStart: number, otherEnd: number) =>
    Math.max(Math.min(start, end), Math.min(otherStart, otherEnd))
    <= Math.min(Math.max(start, end), Math.max(otherStart, otherEnd));

  return overlap(a.lon, b.lon, c.lon, d.lon)
    && overlap(a.lat, b.lat, c.lat, d.lat)
    && crossProduct(a, b, c) * crossProduct(a, b, d) <= 0
    && crossProduct(c, d, a) * crossProduct(c, d, b) <= 0;
}

function isSimpleRing(points: Coordinates[]) {
  if (points.length < 3) return false;

  const origin = points[0];
  const area = points.slice(1).reduce(
    (sum, point, index) => sum + crossProduct(origin, point, points[index + 2] ?? origin),
    0,
  );
  if (Math.abs(area) < 1e-12) return false;

  return points.every((point, edge) => {
    const previous = points[(edge + points.length - 1) % points.length];
    const next = points[(edge + 1) % points.length];
    const direction = (point.lon - previous.lon) * (next.lon - point.lon)
      + (point.lat - previous.lat) * (next.lat - point.lat);
    if (crossProduct(previous, point, next) === 0 && direction < 0) return false;

    return points.slice(edge + 2).every((otherPoint, offset) => {
      const otherEdge = edge + 2 + offset;
      if (edge === 0 && otherEdge === points.length - 1) return true;
      return !edgesIntersect(
        point,
        next,
        otherPoint,
        points[(otherEdge + 1) % points.length],
      );
    });
  });
}

export default function FieldMap({
  location,
  onSelect,
  polygon,
  onPolygonChange,
}: FieldMapProps) {
  const mapRef = useRef<LeafletMap>(null);
  const [draft, setDraft] = useState<Coordinates[] | null>(null);
  const [boundaryError, setBoundaryError] = useState("");
  const [basemap, setBasemap] = useState<keyof typeof MAP_LAYERS>("satellite");
  const [mapNotice, setMapNotice] = useState("");
  const failedTiles = useRef(0);
  const drawing = draft !== null;

  function chooseBasemap(nextBasemap: keyof typeof MAP_LAYERS) {
    failedTiles.current = 0;
    setBasemap(nextBasemap);
    setMapNotice("");
  }

  function handleTileError() {
    failedTiles.current += 1;
    if (failedTiles.current !== 3) return;
    if (basemap === "satellite") {
      chooseBasemap("street");
      setMapNotice("Satellite tiles are unavailable. Showing the street map.");
    } else {
      setMapNotice("Some street map tiles are unavailable.");
    }
  }

  function choosePoint(point: Coordinates) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) ||
      Math.abs(point.lat) > 85.0511 || Math.abs(point.lon) > 180) return;

    if (!draft) {
      onSelect(point);
      return;
    }

    if (draft.length >= MAX_VERTICES) {
      setBoundaryError(`Use up to ${MAX_VERTICES} corners. Finish the boundary or undo a corner.`);
      return;
    }

    if (draft.some((vertex) =>
      Math.abs(vertex.lat - point.lat) < 1e-6 && Math.abs(vertex.lon - point.lon) < 1e-6
    )) {
      setBoundaryError("Choose a different corner, or select Finish boundary to close the shape.");
      return;
    }

    setBoundaryError("");
    setDraft([...draft, point]);
  }

  function selectMapCenter() {
    const center = mapRef.current?.getCenter();
    if (center) choosePoint({ lat: center.lat, lon: center.lng });
  }

  function stopDrawing() {
    setDraft(null);
    setBoundaryError("");
  }

  function finishBoundary() {
    if (!draft || !isSimpleRing(draft)) {
      setBoundaryError("Use at least three corners to make an area, with no crossing edges.");
      return;
    }

    onPolygonChange([...draft, draft[0]]);
    stopDrawing();
  }

  return (
    <div className={styles.picker}>
      <div className={styles.frame} role="region" aria-label="Interactive field map">
        <MapContainer
          ref={mapRef}
          center={[location.lat, location.lon]}
          zoom={FIELD_ZOOM}
          minZoom={3}
          maxZoom={19}
          maxBounds={[[-85.0511, -180], [85.0511, 180]]}
          scrollWheelZoom={false}
          doubleClickZoom={false}
          zoomControl={false}
          className={styles.canvas}
        >
          <TileLayer
            key={basemap}
            {...MAP_LAYERS[basemap]}
            noWrap
            eventHandlers={{ tileerror: handleTileError }}
          />
          <ZoomControl position="topright" />
          <MapClicks onClick={choosePoint} />
          {SERVICE_REGIONS.map(({ id, boundary }) => (
            <Polygon
              key={id}
              positions={boundary.map(({ lat, lon }) => [lat, lon])}
              pathOptions={{ color: "#fbeeab", weight: 2, dashArray: "6 6", fill: false, interactive: false }}
            />
          ))}
          <Marker
            position={[location.lat, location.lon]}
            icon={FIELD_POINT}
            keyboard={false}
            interactive={false}
            alt="Selected field point"
          />
          {polygon.length > 0 && (
            <Polygon
              positions={polygon.map(({ lat, lon }) => [lat, lon])}
              pathOptions={{
                color: "#f2c977",
                fillColor: "#f2c977",
                fillOpacity: 0.22,
                weight: 3,
                interactive: false,
              }}
            />
          )}
          {draft && draft.length > 1 && (
            <Polyline
              positions={draft.map(({ lat, lon }) => [lat, lon])}
              pathOptions={{ color: "#fbeeab", weight: 3, dashArray: "5 5", interactive: false }}
            />
          )}
          {draft?.map(({ lat, lon }) => (
            <CircleMarker
              key={`${lat},${lon}`}
              center={[lat, lon]}
              radius={4}
              pathOptions={{ fillColor: "#fbeeab", fillOpacity: 1, color: "#263b25", weight: 2, interactive: false }}
            />
          ))}
        </MapContainer>
        <span className={styles.reticle} aria-hidden="true" />
        <div className={styles.layers} role="group" aria-label="Map basemap">
          <button type="button" aria-pressed={basemap === "satellite"} onClick={() => chooseBasemap("satellite")}>
            Satellite
          </button>
          <button type="button" aria-pressed={basemap === "street"} onClick={() => chooseBasemap("street")}>
            Street
          </button>
        </div>
      </div>
      <div className={styles.controls} aria-label="Field map controls" role="group">
        <button type="button" className={styles.selectCenter} onClick={selectMapCenter}>
          {drawing ? "Add center corner" : "Select map center"}
        </button>
        {drawing ? (
          <>
            <button type="button" className={styles.active} onClick={finishBoundary} disabled={draft.length < 3}>
              Finish boundary
            </button>
            <button
              type="button"
              disabled={draft.length === 0}
              onClick={() => {
                setDraft(draft.slice(0, -1));
                setBoundaryError("");
              }}
            >
              Undo corner
            </button>
            <button type="button" onClick={stopDrawing}>Cancel</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setDraft([])}>
              {polygon.length ? "Redraw boundary" : "Draw boundary"}
            </button>
            {polygon.length > 0 && (
              <button type="button" onClick={() => onPolygonChange([])}>Clear boundary</button>
            )}
          </>
        )}
      </div>
      {(drawing || mapNotice || boundaryError) && (
        <p className={styles.notice} role="status">
          {[mapNotice, boundaryError || (draft && `Click the corners of your field. ${draft.length} added.`)]
            .filter(Boolean)
            .join(" ")}
        </p>
      )}
    </div>
  );
}
