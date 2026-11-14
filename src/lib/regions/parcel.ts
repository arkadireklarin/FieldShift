import type { Coordinates, FieldParcelSummary, NasaGridCellBounds, SpatialContext } from "../../types/api";
import { findServiceRegion } from "./index";

const EARTH_RADIUS_M = 6_371_008.8;
const LAT_GRID_DEG = 0.5;
const LON_GRID_DEG = 0.625;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function uniqueRingVertices(polygon: readonly Coordinates[]): Coordinates[] {
  if (polygon.length < 3) return [...polygon];
  const first = polygon[0];
  const last = polygon[polygon.length - 1];
  if (Math.abs(first.lat - last.lat) < 1e-9 && Math.abs(first.lon - last.lon) < 1e-9) {
    return polygon.slice(0, -1);
  }
  return [...polygon];
}

function pointInRing(ring: readonly Coordinates[], { lat, lon }: Coordinates): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index];
    const b = ring[previous];
    const onSegmentLat = (a.lat >= lat && b.lat <= lat) || (b.lat >= lat && a.lat <= lat);
    if (onSegmentLat && Math.abs(b.lat - a.lat) < 1e-12) {
      if (lon >= Math.min(a.lon, b.lon) && lon <= Math.max(a.lon, b.lon)) return true;
    }
    if ((a.lat > lat) !== (b.lat > lat)) {
      const xIntersect = ((b.lon - a.lon) * (lat - a.lat)) / (b.lat - a.lat) + a.lon;
      if (Math.abs(lon - xIntersect) < 1e-9) return true;
      if (lon < xIntersect) inside = !inside;
    }
  }
  return inside;
}

function segmentDistanceM(a: Coordinates, b: Coordinates): number {
  const meanLatRad = toRadians((a.lat + b.lat) / 2);
  const dLat = toRadians(b.lat - a.lat) * EARTH_RADIUS_M;
  const dLon = toRadians(b.lon - a.lon) * EARTH_RADIUS_M * Math.cos(meanLatRad);
  return Math.hypot(dLat, dLon);
}

/**
 * Compute the NASA POWER 0.5° × 0.625° MERRA-2 assimilation grid cell containing a point.
 */
export function nasaGridCellBounds({ lat, lon }: Coordinates): NasaGridCellBounds {
  const south = Math.max(-90, Math.floor((lat + 90) / LAT_GRID_DEG) * LAT_GRID_DEG - 90);
  const north = Math.min(90, Math.round((south + LAT_GRID_DEG) * 1e6) / 1e6);
  const west = Math.max(-180, Math.floor((lon + 180) / LON_GRID_DEG) * LON_GRID_DEG - 180);
  const east = Math.min(180, Math.round((west + LON_GRID_DEG) * 1e6) / 1e6);
  return {
    south: Math.round(south * 1e6) / 1e6,
    north,
    west: Math.round(west * 1e6) / 1e6,
    east,
    resolutionDegrees: { lat: 0.5, lon: 0.625 },
  };
}

export function summarizeFieldParcel(
  location: Coordinates,
  polygon: readonly Coordinates[] | undefined,
): FieldParcelSummary | undefined {
  if (!polygon) return undefined;
  const vertices = uniqueRingVertices(polygon);
  if (vertices.length < 3) return undefined;

  const refLat = vertices.reduce((sum, p) => sum + p.lat, 0) / vertices.length;
  const refLon = vertices.reduce((sum, p) => sum + p.lon, 0) / vertices.length;
  const cosLat = Math.cos(toRadians(refLat));

  const projected = vertices.map(({ lat, lon }) => ({
    x: toRadians(lon - refLon) * EARTH_RADIUS_M * cosLat,
    y: toRadians(lat - refLat) * EARTH_RADIUS_M,
  }));

  let signedArea2 = 0;
  let cx6 = 0;
  let cy6 = 0;
  let perimeterM = 0;

  for (let i = 0; i < projected.length; i++) {
    const current = projected[i];
    const next = projected[(i + 1) % projected.length];
    const cross = current.x * next.y - next.x * current.y;
    signedArea2 += cross;
    cx6 += (current.x + next.x) * cross;
    cy6 += (current.y + next.y) * cross;
    perimeterM += segmentDistanceM(vertices[i], vertices[(i + 1) % vertices.length]);
  }

  const areaM2 = Math.abs(signedArea2) / 2;
  const centroidX = Math.abs(signedArea2) > 1e-6 ? cx6 / (3 * signedArea2) : 0;
  const centroidY = Math.abs(signedArea2) > 1e-6 ? cy6 / (3 * signedArea2) : 0;
  const centroid: Coordinates = {
    lat: Math.round((refLat + (centroidY / EARTH_RADIUS_M) * (180 / Math.PI)) * 1e6) / 1e6,
    lon: Math.round((refLon + (centroidX / (EARTH_RADIUS_M * Math.max(cosLat, 1e-6))) * (180 / Math.PI)) * 1e6) / 1e6,
  };

  const cell = nasaGridCellBounds(location);
  const withinSingleNasaGridCell = vertices.every(({ lat, lon }) =>
    lat >= cell.south && lat <= cell.north && lon >= cell.west && lon <= cell.east
  );
  const withinValidatedRegion = vertices.every((vertex) => Boolean(findServiceRegion(vertex)));
  const queryPointInsideParcel = pointInRing(vertices, location);

  return {
    vertexCount: vertices.length,
    areaM2: Math.round(areaM2),
    areaDa: Math.round((areaM2 / 1000) * 10) / 10,
    areaHa: Math.round((areaM2 / 10_000) * 100) / 100,
    perimeterM: Math.round(perimeterM),
    centroid,
    queryPointInsideParcel,
    withinSingleNasaGridCell,
    withinValidatedRegion,
  };
}

export function describeSpatialContext(
  location: Coordinates,
  polygon?: readonly Coordinates[],
): SpatialContext {
  const nasaGridCell = nasaGridCellBounds(location);
  const parcel = summarizeFieldParcel(location, polygon);
  const climateRole = `The selected point (${location.lat.toFixed(4)}° N, ${location.lon.toFixed(4)}° E) queries the surrounding NASA POWER 0.5° × 0.625° grid cell (${nasaGridCell.south.toFixed(3)}°–${nasaGridCell.north.toFixed(3)}° N, ${nasaGridCell.west.toFixed(3)}°–${nasaGridCell.east.toFixed(3)}° E) for daily temperature (T2M) and precipitation (PRECTOTCORR).`;

  if (!parcel) {
    return {
      queryPoint: location,
      nasaGridCell,
      climateRole,
      parcelRole: "No field parcel boundary was drawn. Per-decare water and budget figures are shown per 1 da (1,000 m²); draw a field boundary on the map to calculate parcel area and whole-field water and gross margin totals.",
    };
  }

  const gridNote = parcel.withinSingleNasaGridCell
    ? "All parcel corners fall inside the same NASA POWER climate grid cell, so redrawing corners within this cell does not change the grid-level weather series."
    : "The drawn boundary spans more than one NASA POWER grid cell; the selected pin determines which grid cell is queried.";
  const pinNote = parcel.queryPointInsideParcel
    ? "The climate query pin is inside the drawn parcel."
    : `The climate query pin is outside the drawn parcel (parcel centroid: ${parcel.centroid.lat.toFixed(4)}° N, ${parcel.centroid.lon.toFixed(4)}° E).`;

  return {
    queryPoint: location,
    nasaGridCell,
    parcel,
    climateRole,
    parcelRole: `The drawn parcel (${parcel.vertexCount} corners, ${parcel.areaDa.toFixed(1)} da / ${parcel.areaHa.toFixed(2)} ha) defines the field footprint used to scale per-decare irrigation quotas and gross margin to whole-field totals. ${pinNote} ${gridNote} Sub-grid soil differences within the parcel require local soil inputs (texture, root-zone depth, pH).`,
  };
}
