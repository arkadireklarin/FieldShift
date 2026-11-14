import type {
  CropSuitability,
  DataProvenance,
  RecommendResponse,
  RotationRecommendation,
} from "@/types/api";
import { cropLabels } from "./crop-labels";
import styles from "./recommendation-panel.module.css";

const scoreFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const deltaFormat = new Intl.NumberFormat("en", {
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

type Factor = CropSuitability["factors"][number];
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

function CropCard({ entry, rank }: { entry: CropSuitability; rank: number }) {
  const factors = [...entry.factors].sort((a, b) => b.scoreDelta - a.scoreDelta);
  const strength = factors.find((factor) => factor.scoreDelta > 0);
  const constraint = factors.findLast((factor) => factor.scoreDelta < 0);
  const otherFactors = factors.filter((factor) => factor !== strength && factor !== constraint);

  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          {entry.score !== null && <p className={styles.rank}>Rank {rank}</p>}
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

function RotationCard({ plan, rank }: { plan: RotationRecommendation; rank: number }) {
  return (
    <li className={`${styles.card} ${rank === 1 ? styles.leadPlan : ""}`}>
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
  const suitability = [...(result?.suitability ?? [])].sort(
    (a, b) => (b.score ?? -1) - (a.score ?? -1),
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
        {suitability.length > 0 ? (
          <ol className={styles.cropGrid}>
            {suitability.map((entry, index) => <CropCard key={entry.crop} entry={entry} rank={index + 1} />)}
          </ol>
        ) : (
          <ResultState loading={loading} unavailable={unavailable} result="crop scores" hasResponse={Boolean(result)} />
        )}
      </section>

      <section className={styles.section} id="rotation" aria-labelledby="rotation-title" aria-busy={loading}>
        <div className={styles.sectionHead}>
          <div>
            <h2 id="rotation-title">Rotation plans</h2>
            <p>Ranked alternatives for your next three primary crop cycles.</p>
          </div>
          {isFixture && result && <span className={styles.fixture}>Synthetic demo plans</span>}
        </div>
        {result?.rotations.length ? (
          <ol className={styles.rotationGrid}>
            {result.rotations.slice(0, 3).map((plan, index) => (
              <RotationCard key={plan.cycles.join("-")} plan={plan} rank={index + 1} />
            ))}
          </ol>
        ) : (
          <ResultState loading={loading} unavailable={unavailable} result="rotation plans" hasResponse={Boolean(result)} />
        )}
        {result && (
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
