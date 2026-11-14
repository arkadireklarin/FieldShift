"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Coordinates, CropId, FieldSelection, RecommendResponse } from "@/types/api";
import ClimatePanel from "./climate-panel";
import RecommendationPanel from "./recommendation-panel";
import { cropLabels } from "./crop-labels";
import { DashboardIcon } from "./dashboard-icon";
import { requestRecommendation, type RequestState } from "./field-api";
import type { DevelopmentFixture } from "./dev/field-fixture";
import styles from "./field-dashboard.module.css";

const FieldMap = dynamic(() => import("./field-map"), {
  ssr: false,
  loading: () => <div className={styles.mapLoading} role="status">Loading field map…</div>,
});

const defaultLocation = { lat: 37.5667, lon: 32.775 };
const analysisCacheMs = 5 * 60_000;
const planningMonth = new Intl.DateTimeFormat("en", {
  timeZone: "Europe/Istanbul",
  calendar: "gregory",
  year: "numeric",
  month: "numeric",
});
const navigation = [
  { key: "field", label: "Field setup" },
  { key: "climate", label: "Climate history" },
  { key: "suitability", label: "Crop suitability", icon: "crop" },
  { key: "rotation", label: "Rotation plans" },
] as const;

function formatCoordinate(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(4)}° ${value < 0 ? negative : positive}`;
}

export default function FieldDashboard() {
  const [location, setLocation] = useState<Coordinates>(defaultLocation);
  const [polygon, setPolygon] = useState<Coordinates[]>([]);
  const [previousCrop, setPreviousCrop] = useState<CropId | "">("");
  const [irrigation, setIrrigation] = useState<FieldSelection["irrigation"] | "">("");
  const [soilPh, setSoilPh] = useState("");
  const [analysis, setAnalysis] = useState<RequestState<RecommendResponse>>({ status: "idle" });
  const [fixture, setFixture] = useState<DevelopmentFixture>();
  const [fixtureError, setFixtureError] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const lastAnalysis = useRef<{ key: string; expiresAt: number; data: RecommendResponse } | null>(null);

  useEffect(() => () => activeRequest.current?.abort(), []);

  function resetAnalysis() {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setAnalysis({ status: "idle" });
    setFixture(undefined);
    setFixtureError(false);
  }

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!previousCrop || !irrigation || activeRequest.current) return;

    const field: FieldSelection = { location, previousCrop, irrigation };
    if (polygon.length > 0) field.polygon = polygon;
    if (soilPh !== "") field.measuredSoilPh = Number(soilPh);

    setFixture(undefined);
    setFixtureError(false);
    const now = Date.now();
    const key = JSON.stringify([planningMonth.format(now), field]);
    const cached = lastAnalysis.current;
    if (cached?.key === key && cached.expiresAt > now) {
      setAnalysis({ status: "success", data: cached.data });
      return;
    }

    const controller = new AbortController();
    activeRequest.current = controller;
    setAnalysis({ status: "loading" });

    const result = await requestRecommendation(field, controller.signal);
    if (controller.signal.aborted) return;
    activeRequest.current = null;
    if (result.status === "success") {
      lastAnalysis.current = { key, expiresAt: Date.now() + analysisCacheMs, data: result.data };
    }
    setAnalysis(result);
  }

  async function showFixture() {
    resetAnalysis();
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      if (process.env.NODE_ENV === "development") {
        const { developmentFixture } = await import("./dev/field-fixture");
        if (!controller.signal.aborted) setFixture(developmentFixture);
      }
    } catch {
      if (!controller.signal.aborted) setFixtureError(true);
    } finally {
      if (!controller.signal.aborted) activeRequest.current = null;
    }
  }

  const loading = analysis.status === "loading";
  const result = analysis.status === "success" ? analysis.data : undefined;
  const error = analysis.status === "error" ? analysis.error : undefined;
  const selectedCoordinates = `${formatCoordinate(location.lat, "N", "S")} · ${formatCoordinate(location.lon, "E", "W")}`;

  return (
    <div className={styles.workspace}>
      <a className={styles.skipLink} href="#main">Skip to field workspace</a>
      <aside className={styles.sidebar}>
        <a href="#main" className={styles.brand}>
          <span className={styles.brandMark}><DashboardIcon name="brand" size={24} /></span>
          <span>
            <strong>FieldShift</strong>
            <small>Crop rotation planner</small>
          </span>
        </a>
        <nav aria-label="Dashboard sections" className={styles.navigation}>
          {navigation.map((item) => (
            <a key={item.key} href={`#${item.key}`}>
              <DashboardIcon name={"icon" in item ? item.icon : item.key} size={18} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className={styles.team}>
          <span className={styles.teamMark}>N</span>
          <div><strong>Team Nautilus</strong><small>NASA Space Apps 2026</small></div>
        </div>
      </aside>

      <main className={styles.main} id="main" tabIndex={-1}>
        <header className={styles.pageHeader}>
          <h1>Field intelligence</h1>
          <p>Explore historical climate and plan the next three crop cycles for your field.</p>
        </header>

        <section id="field" aria-label="Field setup" className={styles.setup}>
          <article className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <span className={styles.cardIcon}><DashboardIcon name="pin" size={20} /></span>
                <div>
                  <h2>Field location</h2>
                  <p>Select a point to query the surrounding climate grid cell.</p>
                </div>
              </div>
              <span className={styles.locationPill}><DashboardIcon name="pin" size={15} /> {selectedCoordinates}</span>
            </div>
            <FieldMap
              location={location}
              polygon={polygon}
              onSelect={(point) => {
                resetAnalysis();
                setLocation(point);
              }}
              onPolygonChange={(ring) => {
                resetAnalysis();
                setPolygon(ring);
              }}
            />
          </article>

          <article className={`${styles.card} ${styles.formCard}`}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <span className={styles.cardIcon}><DashboardIcon name="crop" size={20} /></span>
                <div>
                  <h2>Field conditions</h2>
                  <p>Tell us about your last crop and water access.</p>
                </div>
              </div>
            </div>
            <form onSubmit={analyze} className={styles.form}>
              <label className={styles.fieldLabel}>
                Previous crop
                <select required name="previousCrop" value={previousCrop} onChange={(event) => {
                  resetAnalysis();
                  setPreviousCrop(event.target.value as CropId | "");
                }}>
                  <option value="" disabled>Select previous crop</option>
                  {Object.entries(cropLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
              <fieldset className={styles.irrigation}>
                <legend>Irrigation available</legend>
                <div className={styles.options}>
                  {([["available", "Yes"], ["unavailable", "No"]] as const).map(([value, label]) => (
                    <label className={styles.choice} key={value}>
                      <input type="radio" name="irrigation" value={value} checked={irrigation === value} required
                        onChange={() => {
                          resetAnalysis();
                          setIrrigation(value);
                        }} />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className={styles.fieldLabel}>
                <span className={styles.labelRow}>Measured soil pH <span>Optional</span></span>
                <input type="number" name="soilPh" min="0" max="14" step="any" inputMode="decimal"
                  aria-describedby="ph-help" placeholder="e.g. 7.2" value={soilPh} onChange={(event) => {
                    resetAnalysis();
                    setSoilPh(event.target.value);
                  }} />
                <small id="ph-help">Leave blank if you don’t have a measurement.</small>
              </label>
              <button className={styles.analyzeButton} disabled={loading} type="submit">
                {loading ? "Analyzing field…" : "Analyze field"} <DashboardIcon name="arrow" size={18} />
              </button>
              {analysis.status !== "idle" && (
                <p className={styles.formStatus} role="status">
                  {loading ? "Requesting climate history and crop analysis…" : (
                    <>{error ? "Analysis unavailable." : "Analysis complete."}{" "}
                    <a href="#climate">Review details</a>.</>
                  )}
                </p>
              )}
            </form>
            {process.env.NODE_ENV === "development" && (
              <div className={styles.devControls}>
                <button type="button" onClick={fixture ? resetAnalysis : showFixture}>
                  {fixture ? "Clear example data" : "Preview synthetic example"}
                </button>
                {fixtureError && <p role="alert">Could not load the local example.</p>}
              </div>
            )}
          </article>
        </section>

        {fixture && (
          <aside className={styles.fixtureNotice} role="status">
            <DashboardIcon name="info" size={18} />
            <p><strong>Synthetic development example.</strong> Charts, scores, and plans use fixed illustrative data independent of the selected field.</p>
          </aside>
        )}

        <div className={styles.results}>
          <ClimatePanel
            climate={result?.climate}
            error={error}
            fixtureMonths={fixture?.months}
            loading={loading}
          />
          <RecommendationPanel
            recommendation={fixture?.recommendation ?? result}
            unavailable={Boolean(error)}
            loading={loading}
            isFixture={Boolean(fixture)}
            soilPhKnown={fixture ? undefined : soilPh !== ""}
          />
        </div>
      </main>
    </div>
  );
}
