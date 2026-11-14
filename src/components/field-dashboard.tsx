"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Coordinates, CropId, FieldSelection, RecommendResponse, RotationCycle, SoilTexture } from "@/types/api";
import ClimatePanel from "./climate-panel";
import RecommendationPanel from "./recommendation-panel";
import { cropLabels, rotationCycleLabels } from "./crop-labels";
import { DashboardIcon } from "./dashboard-icon";
import DecisionFeedback from "./decision-feedback";
import { initialIntentLabels, isParticipantCode, participantCodePattern, type InitialIntent } from "./decision-feedback-export";
import { requestRecommendation, type RequestState } from "./field-api";
import PlanBudgetPanel from "./plan-budget-panel";
import FarmerView from "./farmer-view";
import { buildFarmerSummary, cycleName, languageNames, type Language } from "./farmer-summary";
import { uiText } from "./ui-text";
import { MAX_ROOTING_DEPTH_CM, MIN_ROOTING_DEPTH_CM, SOIL_TEXTURE_WATER_MM_PER_M } from "@/lib/crops/water-balance";
import { describeApplicability, findServiceRegion } from "@/lib/regions";
import { describeSpatialContext } from "@/lib/regions/parcel";
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
  { key: "field" },
  { key: "climate" },
  { key: "suitability", icon: "crop" },
  { key: "rotation" },
] as const;

function formatCoordinate(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(4)}° ${value < 0 ? negative : positive}`;
}

export default function FieldDashboard() {
  const [location, setLocation] = useState<Coordinates>(defaultLocation);
  const [polygon, setPolygon] = useState<Coordinates[]>([]);
  const [previousCrop, setPreviousCrop] = useState<CropId | "">("");
  const [irrigation, setIrrigation] = useState<FieldSelection["irrigation"] | "">("");
  const [soilTexture, setSoilTexture] = useState<SoilTexture | "">("");
  const [rootingDepthCm, setRootingDepthCm] = useState("");
  const [soilPh, setSoilPh] = useState("");
  const [compareCurrent, setCompareCurrent] = useState(false);
  const [currentCycles, setCurrentCycles] = useState<[RotationCycle | "", RotationCycle | "", RotationCycle | ""]>(["", "", ""]);
  const [pilotEnabled, setPilotEnabled] = useState(false);
  const [participantCode, setParticipantCode] = useState("");
  const [initialIntent, setInitialIntent] = useState<InitialIntent | "">("");
  const [pilotSession, setPilotSession] = useState<{ participantCode: string; initialIntent: InitialIntent }>();
  const [language, setLanguage] = useState<Language>("tr");
  const [analysis, setAnalysis] = useState<RequestState<RecommendResponse>>({ status: "idle" });
  const [fixture, setFixture] = useState<DevelopmentFixture>();
  const [fixtureError, setFixtureError] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const lastAnalysis = useRef<{ key: string; expiresAt: number; data: RecommendResponse } | null>(null);

  useEffect(() => () => activeRequest.current?.abort(), []);
  // The page is served in one language; the chosen one has to reach assistive technology too.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  function resetAnalysis() {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setAnalysis({ status: "idle" });
    setPilotSession(undefined);
    setFixture(undefined);
    setFixtureError(false);
  }

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!previousCrop || !irrigation || activeRequest.current) return;

    const field: FieldSelection = { location, previousCrop, irrigation };
    if (polygon.length > 0) field.polygon = polygon;
    if (soilTexture !== "") field.soilTexture = soilTexture;
    if (rootingDepthCm !== "") field.rootingDepthCm = Number(rootingDepthCm);
    if (soilPh !== "") field.measuredSoilPh = Number(soilPh);
    const latestFirstHarvest = new FormData(event.currentTarget).get("latestFirstHarvest");
    if (typeof latestFirstHarvest === "string" && latestFirstHarvest) field.latestFirstHarvest = latestFirstHarvest;
    const irrigationQuota = new FormData(event.currentTarget).get("irrigationQuota");
    if (irrigation === "available" && typeof irrigationQuota === "string" && irrigationQuota !== "") {
      field.irrigationQuotaM3PerDa = Number(irrigationQuota);
    }
    const [first, second, third] = currentCycles;
    // A partly filled plan is not sent, but it never blocks the analysis either.
    if (compareCurrent && first && second && third) field.currentRotation = [first, second, third];
    if (compareCurrent && pilotEnabled) {
      if (!initialIntent || !isParticipantCode(participantCode)) return;
      setPilotSession({ participantCode, initialIntent });
    }

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
  const t = uiText[language];
  const farmerSummary = result && !fixture ? buildFarmerSummary(result, language, previousCrop || undefined) : undefined;
  const outsidePilotArea = findServiceRegion(location) ? undefined : describeApplicability(undefined).message;
  const spatialPreview = describeSpatialContext(location, polygon);

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
              <span>{t.nav[item.key]}</span>
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
          <div>
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>
          <div className={styles.languages} role="group" aria-label={t.language}>
            {(Object.keys(languageNames) as Language[]).map((code) => (
              <button key={code} type="button" aria-pressed={language === code} onClick={() => setLanguage(code)}>
                {languageNames[code]}
              </button>
            ))}
          </div>
        </header>

        <section id="field" aria-label="Field setup" className={styles.setup}>
          <article className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <span className={styles.cardIcon}><DashboardIcon name="pin" size={20} /></span>
                <div>
                  <h2>{t.locationTitle}</h2>
                  <p>{t.locationLead}</p>
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
            <details className={styles.spatialBox} aria-label="Parcel and NASA POWER grid cell role">
              <summary>{t.gridDetails}</summary>
              <div className={styles.spatialRow}>
                <strong>NASA POWER grid cell (0.5° × 0.625°):</strong>{" "}
                <span>
                  {spatialPreview.nasaGridCell.south.toFixed(3)}°–{spatialPreview.nasaGridCell.north.toFixed(3)}° N,{" "}
                  {spatialPreview.nasaGridCell.west.toFixed(3)}°–{spatialPreview.nasaGridCell.east.toFixed(3)}° E
                </span>
              </div>
              {spatialPreview.parcel ? (
                <div className={styles.spatialParcel}>
                  <p>
                    <strong>Drawn parcel:</strong> {spatialPreview.parcel.areaDa.toFixed(1)} da ({spatialPreview.parcel.areaHa.toFixed(2)} ha ·{" "}
                    {spatialPreview.parcel.perimeterM} m perimeter · {spatialPreview.parcel.vertexCount} corners).{" "}
                    {spatialPreview.parcel.withinSingleNasaGridCell
                      ? "All corners lie in the same NASA POWER climate grid cell; parcel area scales per-decare water and margin to whole-field totals, while local soil inputs differentiate fields inside the cell."
                      : "Corners span multiple NASA POWER grid cells; the selected pin sets the queried cell."}
                  </p>
                  {!spatialPreview.parcel.queryPointInsideParcel && (
                    <button
                      type="button"
                      className={styles.centroidButton}
                      onClick={() => {
                        resetAnalysis();
                        setLocation(spatialPreview.parcel!.centroid);
                      }}
                    >
                      Move climate pin to parcel center ({spatialPreview.parcel.centroid.lat.toFixed(4)}° N, {spatialPreview.parcel.centroid.lon.toFixed(4)}° E)
                    </button>
                  )}
                </div>
              ) : (
                <p className={styles.spatialHint}>
                  <strong>Role in analysis:</strong> The pin queries regional NASA POWER climate for this 0.5° × 0.625° grid cell. Draw a field boundary above to calculate parcel area (decares) for whole-field water and gross margin totals, and enter local soil properties on the right to tailor root-zone water storage.
                </p>
              )}
            </details>
            {outsidePilotArea && <p className={styles.pilotArea} role="status">{outsidePilotArea}</p>}
          </article>

          <article className={`${styles.card} ${styles.formCard}`}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <span className={styles.cardIcon}><DashboardIcon name="crop" size={20} /></span>
                <div>
                  <h2>{t.conditionsTitle}</h2>
                  <p>{t.conditionsLead}</p>
                </div>
              </div>
            </div>
            <form onSubmit={analyze} className={styles.form}>
              <label className={styles.fieldLabel}>
                {t.previousCrop}
                <select required name="previousCrop" value={previousCrop} onChange={(event) => {
                  resetAnalysis();
                  setPreviousCrop(event.target.value as CropId | "");
                }}>
                  <option value="" disabled>{t.selectCrop}</option>
                  {Object.keys(cropLabels).map((id) => (
                    <option key={id} value={id}>{cycleName(id as CropId, language)}</option>
                  ))}
                </select>
              </label>
              <fieldset className={styles.irrigation}>
                <legend>{t.irrigation}</legend>
                <div className={styles.options}>
                  {([["available", t.yes], ["unavailable", t.no]] as const).map(([value, label]) => (
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
              <details className={styles.optional}>
                <summary>{t.optionalDetails}</summary>
                <p className={styles.optionalLead}>{t.optionalLead}</p>
                {irrigation === "available" && (
                  <label className={styles.fieldLabel}>
                    <span className={styles.labelRow}>Seasonal irrigation quota <span>Optional</span></span>
                    <input type="number" id="irrigation-quota" name="irrigationQuota" min="0" max="10000" step="any"
                      inputMode="decimal" placeholder="Net m³ per decare" aria-describedby="quota-help" onInput={resetAnalysis} />
                    <small id="quota-help">Enter the water that can reach the roots in each crop season, after delivery losses. 1 mm over 1 decare equals 1 m³.</small>
                  </label>
                )}
                <fieldset className={styles.soilGroup} aria-describedby="soil-group-help">
                  <legend>Local soil properties <span>Optional · from soil report or field knowledge</span></legend>
                  <p id="soil-group-help">
                    NASA POWER supplies grid-cell weather. Local soil texture and root-zone depth set how much pre-planting winter rain the root zone can store (FAO-56 tables 19 &amp; 22). When left blank, the model uses the 130 mm Konya trial cap and omits pH.
                  </p>
                  <label className={styles.fieldLabel}>
                    <span className={styles.labelRow}>Soil texture class <span>Optional · mm/m</span></span>
                    <select name="soilTexture" value={soilTexture} aria-describedby="soil-texture-help" onChange={(event) => {
                      resetAnalysis();
                      setSoilTexture(event.target.value as SoilTexture | "");
                    }}>
                      <option value="">Unmeasured (default 130 mm/m Konya trial cap)</option>
                      {(Object.entries(SOIL_TEXTURE_WATER_MM_PER_M) as [SoilTexture, (typeof SOIL_TEXTURE_WATER_MM_PER_M)[SoilTexture]][]).map(
                        ([id, info]) => (
                          <option key={id} value={id}>
                            {info.label} — {info.mmPerM} mm/m (FAO-56 {info.faoRangeMmPerM})
                          </option>
                        ),
                      )}
                    </select>
                    <small id="soil-texture-help">Extractable preseason water capacity per meter of root zone (FAO-56 table 19).</small>
                  </label>
                  <label className={styles.fieldLabel}>
                    <span className={styles.labelRow}>Effective root-zone depth <span>Optional · cm</span></span>
                    <input type="number" name="rootingDepthCm" min={MIN_ROOTING_DEPTH_CM} max={MAX_ROOTING_DEPTH_CM} step="1"
                      inputMode="numeric" aria-describedby="root-depth-help" placeholder="e.g. 50 (shallow caliche) or 120"
                      value={rootingDepthCm} onChange={(event) => {
                        resetAnalysis();
                        setRootingDepthCm(event.target.value);
                      }} />
                    <small id="root-depth-help">
                      Unrestricted soil depth above hardpan, gravel or water table ({MIN_ROOTING_DEPTH_CM}–{MAX_ROOTING_DEPTH_CM} cm), bounded by each crop’s FAO-56 table 22 max root depth.
                    </small>
                  </label>
                  <label className={styles.fieldLabel}>
                    <span className={styles.labelRow}>Measured soil pH <span>Optional · pH (H₂O)</span></span>
                    <input type="number" name="soilPh" min="0" max="14" step="any" inputMode="decimal"
                      aria-describedby="ph-help" placeholder="e.g. 7.2 or 8.2" value={soilPh} onChange={(event) => {
                        resetAnalysis();
                        setSoilPh(event.target.value);
                      }} />
                    <small id="ph-help">Compared with FAO EcoCrop pH bands (10% suitability weight). Omitted when blank.</small>
                  </label>
                </fieldset>
                <label className={styles.fieldLabel}>
                  <span className={styles.labelRow}>Latest acceptable first harvest <span>Optional</span></span>
                  <input type="month" id="latest-first-harvest" name="latestFirstHarvest" min="1900-01" max="2199-12"
                    pattern="(?:19|20|21)[0-9]{2}-(?:0[1-9]|1[0-2])" placeholder="YYYY-MM"
                    aria-describedby="harvest-deadline-help" onInput={resetAnalysis} />
                  <small id="harvest-deadline-help">Plans with a first harvest after this month are excluded.</small>
                </label>
              </details>
              <div className={styles.comparisonInput}>
                <label className={styles.comparisonToggle}>
                  <input type="checkbox" checked={compareCurrent} onChange={(event) => {
                    resetAnalysis();
                    setCompareCurrent(event.target.checked);
                    if (!event.target.checked) setPilotEnabled(false);
                  }} />
                  {t.currentRotation}
                </label>
                {compareCurrent && (
                  <fieldset className={styles.currentRotation} aria-describedby="current-rotation-help">
                    <legend>{t.currentRotation}</legend>
                    <p id="current-rotation-help">{t.currentRotationHelp}</p>
                    {currentCycles.map((cycle, index) => (
                      <label className={styles.fieldLabel} key={index}>
                        {t.cycle(index + 1)}
                        <select value={cycle} onChange={(event) => {
                          resetAnalysis();
                          const updated: typeof currentCycles = [...currentCycles];
                          updated[index] = event.target.value as RotationCycle | "";
                          setCurrentCycles(updated);
                        }}>
                          <option value="">{t.selectCycle}</option>
                          {Object.keys(rotationCycleLabels).map((id) => (
                            <option key={id} value={id}>{cycleName(id as RotationCycle, language)}</option>
                          ))}
                        </select>
                      </label>
                    ))}
                    <label className={styles.comparisonToggle}>
                      <input type="checkbox" checked={pilotEnabled} onChange={(event) => {
                        resetAnalysis();
                        setPilotEnabled(event.target.checked);
                        setParticipantCode("");
                        setInitialIntent("");
                      }} />
                      Record a pilot session
                    </label>
                    {pilotEnabled && (
                      <fieldset className={styles.currentRotation} aria-describedby="pilot-intent-help">
                        <legend>Before viewing the results</legend>
                        <p id="pilot-intent-help">Use a study code such as C-01 in place of a name. Pilot answers stay in this browser until exported.</p>
                        <label className={styles.fieldLabel}>
                          Participant code
                          <input type="text" required pattern={participantCodePattern} maxLength={24}
                            value={participantCode} onChange={(event) => {
                              resetAnalysis();
                              setParticipantCode(event.target.value);
                            }} />
                        </label>
                        <label className={styles.fieldLabel}>
                          Initial intention
                          <select required value={initialIntent} onChange={(event) => {
                            resetAnalysis();
                            setInitialIntent(event.target.value as InitialIntent | "");
                          }}>
                            <option value="" disabled>Select an intention</option>
                            {Object.entries(initialIntentLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                          </select>
                        </label>
                      </fieldset>
                    )}
                  </fieldset>
                )}
              </div>
              <button className={styles.analyzeButton} disabled={loading} type="submit">
                {loading ? t.analyzing : t.analyze} <DashboardIcon name="arrow" size={18} />
              </button>
              {analysis.status !== "idle" && (
                <p className={styles.formStatus} role="status">
                  {loading ? t.loading : (
                    <>{error ? t.failed : ""}{" "}
                    <a href={farmerSummary ? "#recommendation" : "#climate"}>{t.seeResult}</a>.</>
                  )}
                </p>
              )}
            </form>
            {process.env.NODE_ENV === "development" && !pilotEnabled && (
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
          {farmerSummary && (
            <FarmerView summary={farmerSummary} language={language} currentSequence={result?.rotationComparison?.current.schedule.map(({ crop }) => crop)} />
          )}
          {result?.applicability?.status === "outside_validated_region" && (
            <p className={styles.pilotArea} role="status">{t.outsideRegion}</p>
          )}
          <details className={styles.expert} open={!farmerSummary}>
            <summary>{t.expertDetails}</summary>
            <p className={styles.expertLead}>{t.expertLead}</p>
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
          {result && !fixture && (
            <PlanBudgetPanel result={result} irrigated={irrigation === "available"} />
          )}
          </details>
          {result?.rotationComparison && pilotSession && (
            <DecisionFeedback
              comparison={result.rotationComparison}
              strategies={result.rotationStrategies}
              robustPlan={result.rotationStressTest?.robustPlan}
              harvestDeadline={result.harvestDeadline?.month}
              irrigationQuota={result.irrigationQuota?.limitM3PerDa}
              provenance={result.climate.provenance}
              participantCode={pilotSession.participantCode}
              initialIntent={pilotSession.initialIntent}
            />
          )}
        </div>
      </main>
    </div>
  );
}
