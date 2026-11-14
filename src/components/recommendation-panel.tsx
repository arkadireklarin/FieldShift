import type {
  CropSuitability,
  DataProvenance,
  ModelEvidence,
  RecommendResponse,
  RotationCalendar,
  RotationRecommendation,
  RotationStrategy,
  RotationStressTest,
} from "@/types/api";
import { cropLabels, rotationCycleLabels } from "./crop-labels";
import { rotationPriorityLabels } from "./rotation-priority-labels";
import RotationStrategies from "./rotation-strategies";
import { DeadlineResult, DryYearResult } from "./rotation-constraints";
import styles from "./recommendation-panel.module.css";

const scoreFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const deltaFormat = new Intl.NumberFormat("en", {
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});
const monthFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

type Factor = CropSuitability["factors"][number];
type RotationComparison = NonNullable<RecommendResponse["rotationComparison"]>;
type CalendarBenchmark = NonNullable<RecommendResponse["calendarBenchmark"]>;
type IrrigationQuota = NonNullable<RecommendResponse["irrigationQuota"]>;
const percentFormat = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 0 });
const waterFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

interface RecommendationPanelProps {
  recommendation?: Omit<RecommendResponse, "climate">;
  loading: boolean;
  unavailable: boolean;
  isFixture: boolean;
  soilPhKnown?: boolean;
}

function ResultState({
  loading,
  unavailable,
  result,
  hasResponse,
}: {
  loading: boolean;
  unavailable: boolean;
  result: "crop scores" | "rotation plans";
  hasResponse: boolean;
}) {
  if (loading) {
    return <p className={styles.empty} role="status">Calculating {result}…</p>;
  }

  if (unavailable) {
    return (
      <div className={styles.empty}>
        <strong>{result === "crop scores" ? "Crop scores unavailable" : "Rotation plans unavailable"}</strong>
        <p><a href="#climate">Review the analysis error</a> and try again.</p>
      </div>
    );
  }

  return (
    <p className={styles.empty}>
      {hasResponse
        ? `The analysis returned no ${result} for this field.`
        : `Analyze your field to see ${result} here.`}
    </p>
  );
}

function Score({ score }: { score: number }) {
  return (
    <span className={styles.score}>
      {scoreFormat.format(score)} <span>/ 100</span>
    </span>
  );
}

function FactorItem({ factor }: { factor: Factor }) {
  const signClass = factor.scoreDelta > 0
    ? styles.positive
    : factor.scoreDelta < 0 ? styles.negative : styles.neutral;

  return (
    <li className={styles.factor}>
      <span className={signClass}>
        {deltaFormat.format(factor.scoreDelta)}
      </span>
      <div>
        <strong>{factor.label}</strong>
        <p>{factor.explanation}</p>
      </div>
    </li>
  );
}

function WaterVolume({ volume }: { volume: number }) {
  return <>{waterFormat.format(volume)} m³/da</>;
}

/** Only crops that can enter rotation plans are ranked. */
function isRanked(entry: CropSuitability): boolean {
  return entry.score !== null && entry.feasibility?.status !== "excluded";
}

function CropCard({ entry, rank }: { entry: CropSuitability; rank?: number }) {
  const factors = [...entry.factors].sort((a, b) => b.scoreDelta - a.scoreDelta);
  const strength = factors.find((factor) => factor.scoreDelta > 0);
  const constraint = factors.findLast((factor) => factor.scoreDelta < 0);
  const otherFactors = factors.filter((factor) => factor !== strength && factor !== constraint);

  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          {rank !== undefined && <p className={styles.rank}>Rank {rank}</p>}
          <h3>{cropLabels[entry.crop]}</h3>
        </div>
        {entry.score === null
          ? <span className={styles.missing}>Unscored</span>
          : <Score score={entry.score} />}
      </div>
      {entry.score === null ? (
        <p className={styles.muted}>Insufficient evidence for a score.</p>
      ) : (
        <meter
          className={styles.meter}
          min={0}
          max={100}
          value={entry.score}
          aria-label={`${cropLabels[entry.crop]} suitability`}
        />
      )}
      {entry.feasibility?.status === "excluded" && (
        <div className={styles.warning}>
          <strong>Excluded from rotation plans</strong>
          <TextList items={entry.feasibility.reasons.map(({ message }) => message)} />
        </div>
      )}
      {entry.feasibility?.status === "unscored" && (
        <TextList items={entry.feasibility.reasons.map(({ message }) => message)} />
      )}
      {entry.water && (
        <dl className={`${styles.calendarMetrics} ${styles.cropWater}`}>
          <div><dt>Mean seasonal irrigation at the root zone</dt><dd><WaterVolume volume={entry.water.netIrrigationRequirementMm} /></dd></div>
          <div><dt>Modeled water need met without irrigation</dt><dd>{percentFormat.format(entry.water.rainfedSupplyShare)}</dd></div>
          <div><dt>Complete water seasons</dt><dd>{entry.water.seasons}</dd></div>
        </dl>
      )}
      {(strength || constraint) && (
        <ul className={styles.factors} aria-label="Main score factors">
          {strength && <FactorItem factor={strength} />}
          {constraint && <FactorItem factor={constraint} />}
        </ul>
      )}
      {(otherFactors.length > 0 || entry.limitations.length > 0) && (
        <details className={styles.details}>
          <summary>Score details</summary>
          {otherFactors.length > 0 && (
            <ul className={styles.factors}>
              {otherFactors.map((factor, index) => (
                <FactorItem key={`${factor.label}-${index}`} factor={factor} />
              ))}
            </ul>
          )}
          <TextList items={entry.limitations} />
        </details>
      )}
    </li>
  );
}

function TextList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className={styles.textList}>
      {items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
    </ul>
  );
}

function CalendarMonth({ month }: { month: string }) {
  return <time dateTime={month}>{monthFormat.format(new Date(`${month}-01T00:00:00Z`))}</time>;
}

function RotationCalendarCard({ calendar, label, href, benchmark, checks }: {
  calendar: RotationCalendar;
  label: string;
  href?: string;
  benchmark?: CalendarBenchmark["baseline"] | CalendarBenchmark["selected"];
  checks?: string[];
}) {
  const firstHarvest = calendar.schedule.find(({ crop }) => crop !== "fallow")?.harvestMonth;

  return (
    <li className={styles.comparisonCard}>
      <h4 className={styles.comparisonCardTitle}>
        {href ? <a href={href}>{label}</a> : label}
      </h4>
      <ol className={styles.timeline}>
        {calendar.schedule.map(({ crop, plantingMonth, harvestMonth }) => (
          <li key={plantingMonth}>
            <strong>{rotationCycleLabels[crop]}</strong>
            <span><CalendarMonth month={plantingMonth} /> – <CalendarMonth month={harvestMonth} /></span>
          </li>
        ))}
      </ol>
      <dl className={styles.calendarMetrics}>
        <div><dt>First harvest</dt><dd>{firstHarvest ? <CalendarMonth month={firstHarvest} /> : "None"}</dd></div>
        <div><dt>Total months</dt><dd>{calendar.totalMonths}</dd></div>
        <div><dt>Months without a primary crop</dt><dd>{calendar.uncroppedMonths}</dd></div>
        <div><dt>Different crops</dt><dd>{calendar.distinctCropCount}</dd></div>
        <div><dt>Different crop families</dt><dd>{calendar.distinctFamilyCount}</dd></div>
        {benchmark && (
          <>
            <div><dt>Historical model score</dt><dd>{benchmark.historicalScore === undefined ? "Unavailable" : `${scoreFormat.format(benchmark.historicalScore)} / 100`}</dd></div>
            <div><dt>Peak seasonal irrigation, historical</dt><dd>{benchmark.waterM3PerDa === undefined ? "Unavailable" : <WaterVolume volume={benchmark.waterM3PerDa} />}</dd></div>
            {benchmark.dryYearWaterM3PerDa !== undefined && (
              <div><dt>Peak seasonal irrigation, dry replay</dt><dd><WaterVolume volume={benchmark.dryYearWaterM3PerDa} /></dd></div>
            )}
          </>
        )}
      </dl>
      {checks && checks.length > 0 && (
        <ul className={styles.benchmarkChecks}>{checks.map((check) => <li key={check}>{check}</li>)}</ul>
      )}
    </li>
  );
}

function IrrigationQuotaPanel({ quota }: { quota: IrrigationQuota }) {
  const hasReplay = quota.dryYearMatchingCount !== undefined;

  return (
    <section className={styles.quota} aria-labelledby="irrigation-quota-title" data-unmet={quota.matchingCount === 0 || undefined}>
      <h3 id="irrigation-quota-title">Seasonal irrigation quota</h3>
      <p>
        {quota.candidateCount === 0
          ? <>The model had no candidate rotations to check against <strong><WaterVolume volume={quota.limitM3PerDa} /></strong>.</>
          : <><strong>{quota.matchingCount} of {quota.candidateCount}</strong> candidate rotations fit a cap of <strong><WaterVolume volume={quota.limitM3PerDa} /></strong>.</>}
        {hasReplay ? " Each crop season must fit in both the historical model and the dry-year replay." : " Each crop season must fit in the historical model."}
      </p>
      {quota.withoutWaterEstimateCount > 0 && (
        <p>Water estimates were unavailable for {quota.withoutWaterEstimateCount} {quota.withoutWaterEstimateCount === 1 ? "candidate" : "candidates"}.</p>
      )}
      {quota.matchingCount === 0 && quota.minimumRequiredM3PerDa !== undefined && (
        <p>The lowest modeled cap for an eligible rotation is <strong><WaterVolume volume={quota.minimumRequiredM3PerDa} /></strong>.</p>
      )}
      {quota.matchingCount === 0 && quota.candidateCount > 0 && <p><a href="#irrigation-quota">Review the irrigation quota</a></p>}
      {quota.candidateCount === 0 && <p><a href="#field">Review field inputs</a></p>}
      <p>In each run, the largest of the three crop-season estimates is checked against the cap. Pumping volumes can be higher than the estimated volume at the root zone because of delivery losses.</p>
    </section>
  );
}

function CalendarBenchmarkPanel({ benchmark, quota }: { benchmark: CalendarBenchmark; quota?: IrrigationQuota }) {
  const { baseline, selected } = benchmark;
  const checks: string[] = [];
  if (!baseline.meetsDeadline) checks.push("Misses the first harvest deadline");
  if (quota && baseline.fitsQuota !== true) {
    checks.push(baseline.waterM3PerDa === undefined ? "Historical quota fit could not be verified" : "Exceeds the irrigation quota in the historical model");
  }
  if (quota?.dryYearMatchingCount !== undefined && baseline.dryYearFitsQuota !== true) {
    checks.push(baseline.dryYearWaterM3PerDa === undefined ? "Dry-replay quota fit could not be verified" : "Exceeds the irrigation quota in the dry replay");
  }

  return (
    <section className={styles.comparison} aria-labelledby="calendar-benchmark-title">
      <h3 id="calendar-benchmark-title">Calendar-only benchmark</h3>
      <p>The benchmark uses the same crop catalog to find the earliest first harvest, then the earliest finish. It breaks ties by crop order alphabetically and selects a sequence before checking climate or irrigation.</p>
      <ul className={styles.comparisonGrid}>
        <RotationCalendarCard calendar={baseline.calendar} label="Calendar only" benchmark={baseline} checks={checks} />
        {selected && <RotationCalendarCard calendar={selected.calendar} label="Highest-scoring eligible plan" benchmark={selected} />}
      </ul>
      {!selected && <p>The model returned no eligible plan to compare with the benchmark.</p>}
      <p>Peak irrigation is the largest modeled seasonal volume at the root zone across a plan’s crops.</p>
    </section>
  );
}

function ModelEvidencePanel({ evidence }: { evidence: ModelEvidence }) {
  const groups = [
    { kind: "calibration", label: "Calibration checks", note: "These trials informed the model’s parameters." },
    { kind: "consistency", label: "Consistency checks", note: "These checks compare separate field outcomes with the model." },
  ] as const;

  return (
    <details className={styles.evidence}>
      <summary>Published field evidence</summary>
      <p>{evidence.site}</p>
      {groups.map(({ kind, label, note }) => {
        const checks = evidence.checks.filter((check) => check.kind === kind);
        if (checks.length === 0) return null;

        return (
          <section className={styles.evidenceGroup} key={kind} aria-label={label}>
            <h3>{label} · {checks.filter(({ agrees }) => agrees).length} of {checks.length} agree</h3>
            <p>{note}</p>
            <ul>
              {checks.map(({ id, claim, observed, predicted, agrees, source }) => (
                <li key={id}>
                  <p><strong>{claim}</strong> · {agrees ? "Agrees" : "Disagrees"}</p>
                  <p><span className={styles.evidenceLabel}>Field trial</span> {observed}</p>
                  <p><span className={styles.evidenceLabel}>Model</span> {predicted}</p>
                  <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <p>{evidence.pending}</p>
    </details>
  );
}

function RotationComparisonPanel({ comparison, strategies, robustPlan }: {
  comparison: RotationComparison;
  strategies: readonly RotationStrategy[];
  robustPlan?: RotationStressTest["robustPlan"];
}) {
  const rankedSequences = new Set(comparison.alternatives.map((calendar) => calendar.schedule.map(({ crop }) => crop).join(",")));
  const additionalStrategies = strategies.filter(({ plan }) => !rankedSequences.has(plan.cycles.join(",")));

  return (
    <section className={styles.comparison} aria-labelledby="rotation-comparison-title">
      <h3 id="rotation-comparison-title">Compare rotation calendars</h3>
      <p>
        The current rotation follows the order you entered. All calendars start in the same planning month and may finish at different times.
      </p>
      <ul className={styles.comparisonGrid}>
        <RotationCalendarCard calendar={comparison.current} label="Current rotation" />
        {comparison.alternatives.map((calendar, index) => (
          <RotationCalendarCard key={index} calendar={calendar} label={`Plan ${index + 1}`} href={`#rotation-plan-${index + 1}`} />
        ))}
        {additionalStrategies.map(({ calendar, plan, priorities }) => (
          <RotationCalendarCard key={plan.cycles.join(",")} calendar={calendar}
            label={priorities.map((priority) => rotationPriorityLabels[priority]).join(" · ")} />
        ))}
        {robustPlan && !rankedSequences.has(robustPlan.plan.cycles.join(",")) && (
          <RotationCalendarCard calendar={robustPlan.calendar} label="Best across both scenarios" href="#rotation-stress-test" />
        )}
      </ul>
      <p>
        Total months run from the planning month through the end of each calendar’s third cycle.
        Months without a primary crop count waiting time before planting, gaps between crops, and fallow within that span.
        These are calendar estimates. Water use and ground cover depend on field conditions.
      </p>
    </section>
  );
}

function RotationCard({ plan, rank }: { plan: RotationRecommendation; rank: number }) {
  return (
    <li id={`rotation-plan-${rank}`} className={`${styles.card} ${styles.rotationCard} ${rank === 1 ? styles.leadPlan : ""}`}>
      <div className={styles.cardHead}>
        <h3>Plan {rank}</h3>
        <Score score={plan.score} />
      </div>
      <ol className={styles.cycles} aria-label="Primary crops in planting order">
        {plan.cycles.map((crop, index) => (
          <li key={index}>
            <span>Cycle {index + 1}</span>
            <strong>{cropLabels[crop]}</strong>
          </li>
        ))}
      </ol>
      <TextList items={plan.explanations} />
      {plan.limitations.length > 0 && (
        <div className={styles.warning}>
          <strong>Plan limitations</strong>
          <TextList items={plan.limitations} />
        </div>
      )}
    </li>
  );
}

function Provenance({ source }: { source: DataProvenance }) {
  if (source.kind === "assumption") return <p>{source.description}</p>;

  const label = source.kind === "nasa_power" ? "NASA POWER historical grid data" :
    source.kind === "cached_nasa_power" ? "Cached NASA POWER historical grid data" :
    "NASA POWER grid data unavailable";
  const sourceUrl = URL.canParse(source.sourceUrl) ? new URL(source.sourceUrl) : undefined;
  const link = sourceUrl?.protocol === "https:" ? sourceUrl.href : undefined;

  return (
    <div>
      <p>{label} · {source.period.start} to {source.period.end}</p>
      {source.kind === "unavailable" && <p>{source.reason}</p>}
      {"retrievedAt" in source && <p>Retrieved <time dateTime={source.retrievedAt}>{source.retrievedAt}</time></p>}
      {source.kind === "cached_nasa_power" && <p>Cached <time dateTime={source.cachedAt}>{source.cachedAt}</time></p>}
      {link && <p><a href={link} target="_blank" rel="noreferrer">View source request</a></p>}
    </div>
  );
}

export default function RecommendationPanel({
  recommendation,
  loading,
  unavailable,
  isFixture,
  soilPhKnown,
}: RecommendationPanelProps) {
  const result = loading || unavailable ? undefined : recommendation;
  const applicability = result?.applicability;
  const outsideRegion = applicability?.status === "outside_validated_region";
  const suitability = [...(result?.suitability ?? [])].sort(
    (a, b) => Number(isRanked(b)) - Number(isRanked(a)) || (b.score ?? -1) - (a.score ?? -1),
  );

  return (
    <>
      <section className={styles.section} id="suitability" aria-labelledby="suitability-title" aria-busy={loading}>
        <div className={styles.sectionHead}>
          <div>
            <h2 id="suitability-title">Crop suitability</h2>
            <p>Relative scores based on provisional crop profiles and field inputs.</p>
          </div>
          {isFixture && result && <span className={styles.fixture}>Synthetic demo scores</span>}
        </div>
        {outsideRegion ? (
          <p className={styles.empty}>Crop scores are unavailable for this location. <a href="#rotation">See regional scope</a>.</p>
        ) : suitability.length > 0 ? (
          <ol className={styles.cropGrid}>
            {suitability.map((entry, index) => (
              <CropCard key={entry.crop} entry={entry} rank={isRanked(entry) ? index + 1 : undefined} />
            ))}
          </ol>
        ) : (
          <ResultState loading={loading} unavailable={unavailable} result="crop scores" hasResponse={Boolean(result)} />
        )}
      </section>

      <section className={styles.section} id="rotation" aria-labelledby="rotation-title" aria-busy={loading}>
        <div className={styles.sectionHead}>
          <div>
            <h2 id="rotation-title">Rotation plans</h2>
            <p>Explore what changes when you prioritize model score, first harvest, or crop family diversity.</p>
          </div>
          {isFixture && result && <span className={styles.fixture}>Synthetic demo plans</span>}
        </div>
        {applicability && <p className={styles.region} data-outside={outsideRegion || undefined}>{applicability.message}</p>}
        {result?.harvestDeadline && <DeadlineResult deadline={result.harvestDeadline} />}
        {result?.irrigationQuota && <IrrigationQuotaPanel quota={result.irrigationQuota} />}
        {result?.rotationStrategies && <RotationStrategies strategies={result.rotationStrategies} />}
        {result?.rotationStressTest && (
          <DryYearResult stress={result.rotationStressTest} hasDeadline={Boolean(result.harvestDeadline)} hasQuota={Boolean(result.irrigationQuota)} />
        )}
        {result?.rotationComparison && (
          <RotationComparisonPanel comparison={result.rotationComparison} strategies={result.rotationStrategies ?? []}
            robustPlan={result.rotationStressTest?.robustPlan} />
        )}
        {result?.calendarBenchmark && <CalendarBenchmarkPanel benchmark={result.calendarBenchmark} quota={result.irrigationQuota} />}
        {result?.rotations.length ? (
          <section className={styles.rankedSection} aria-labelledby="ranked-rotation-title">
            <h3 id="ranked-rotation-title">Top plans by model score</h3>
            <ol className={styles.rotationGrid}>
              {result.rotations.slice(0, 3).map((plan, index) => (
                <RotationCard key={plan.cycles.join("-")} plan={plan} rank={index + 1} />
              ))}
            </ol>
          </section>
        ) : outsideRegion || result?.harvestDeadline?.candidateCount || result?.irrigationQuota?.candidateCount ? null : (
          <ResultState loading={loading} unavailable={unavailable} result="rotation plans" hasResponse={Boolean(result)} />
        )}
        {result?.modelEvidence && !outsideRegion && <ModelEvidencePanel evidence={result.modelEvidence} />}
        {result && !outsideRegion && (
          <aside className={styles.modelNotes} aria-label="Assumptions and limitations">
            <h3>Assumptions and limitations</h3>
            <p>Suitability and rotation scores use provisional crop profiles and describe relative fit.</p>
            {soilPhKnown === false && <p>Measured soil pH was unavailable and omitted from scoring.</p>}
            <TextList items={result.limitations} />
            {result.provenance.length > 0 && (
              <ul className={styles.provenance}>
                {result.provenance.map((source, index) => (
                  <li key={index}><Provenance source={source} /></li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </section>
    </>
  );
}
