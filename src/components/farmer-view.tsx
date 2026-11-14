import type { RotationCycle } from "@/types/api";
import { cycleName, type FarmerSummary, type Language } from "./farmer-summary";
import { DashboardIcon } from "./dashboard-icon";
import styles from "./farmer-view.module.css";

interface FarmerViewProps {
  summary: FarmerSummary;
  language: Language;
  /** The grower's own three cycles, shown beside the recommendation when they entered one. */
  currentSequence?: readonly RotationCycle[];
}

const headings = {
  tr: { now: "Şimdiki planınız", suggested: "Önerimiz", why: "Neden?", care: "Dikkat edilecekler" },
  en: { now: "Your plan now", suggested: "What we suggest", why: "Why?", care: "What to watch" },
} satisfies Record<Language, Record<string, string>>;

function Sequence({ sequence, language, title, muted }: {
  sequence: readonly RotationCycle[];
  language: Language;
  title: string;
  muted?: boolean;
}) {
  return (
    <div className={styles.strip} data-muted={muted || undefined}>
      <h3>{title}</h3>
      <ol>
        {sequence.map((cycle, index) => (
          <li key={index} data-fallow={cycle === "fallow" || undefined}>{cycleName(cycle, language)}</li>
        ))}
      </ol>
    </div>
  );
}

export default function FarmerView({ summary, language, currentSequence }: FarmerViewProps) {
  const t = headings[language];
  const changed = currentSequence && summary.sequence
    ? summary.sequence.map((cycle, index) => cycle !== currentSequence[index])
    : undefined;

  return (
    <section className={styles.view} id="recommendation" aria-labelledby="recommendation-title">
      <h2 id="recommendation-title">{summary.headline}</h2>

      {summary.sequence && (
        <div className={styles.sequences}>
          {currentSequence && <Sequence sequence={currentSequence} language={language} title={t.now} muted />}
          <div className={styles.strip} data-highlight={Boolean(changed) || undefined}>
            <h3>{t.suggested}</h3>
            <ol>
              {summary.sequence.map((cycle, index) => (
                <li key={index} data-fallow={cycle === "fallow" || undefined} data-changed={changed?.[index] || undefined}>
                  {cycleName(cycle, language)}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {summary.reasons.length > 0 && (
        <div className={styles.block}>
          <h3>{t.why}</h3>
          <ul>{summary.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
      )}

      {summary.dryYear && (
        <p className={styles.dryYear}><DashboardIcon name="info" size={18} /> {summary.dryYear}</p>
      )}

      {summary.alternative && <p className={styles.alternative}>{summary.alternative}</p>}

      <div className={styles.block}>
        <h3>{t.care}</h3>
        <ul>{summary.cautions.map((caution) => <li key={caution}>{caution}</li>)}</ul>
      </div>

      <p className={styles.footer}>{summary.footer}</p>
    </section>
  );
}
