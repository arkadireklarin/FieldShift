import type { RecommendResponse } from "@/types/api";
import { cropLabels, rotationCycleLabels } from "./crop-labels";
import { rotationPriorityLabels } from "./rotation-priority-labels";
import styles from "./rotation-constraints.module.css";

type HarvestDeadline = NonNullable<RecommendResponse["harvestDeadline"]>;
type DryYearReplay = NonNullable<RecommendResponse["rotationStressTest"]>;

const monthFormat = new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" });
const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

function CalendarMonth({ month }: { month: string }) {
  return <time dateTime={month}>{monthFormat.format(new Date(`${month}-01T00:00:00Z`))}</time>;
}

export function DeadlineResult({ deadline }: { deadline: HarvestDeadline }) {
  return (
    <section className={styles.deadline} aria-labelledby="harvest-deadline-title" data-unmet={deadline.matchingCount === 0 || undefined}>
      <h3 id="harvest-deadline-title">First harvest deadline</h3>
      <p>
        {deadline.candidateCount === 0
          ? <>The model had no candidate rotations to check against <CalendarMonth month={deadline.month} />.</>
          : <><strong>{deadline.matchingCount} of {deadline.candidateCount}</strong> modeled rotations reach first harvest by <CalendarMonth month={deadline.month} />.</>}
      </p>
      {deadline.matchingCount === 0 && deadline.earliestPossibleMonth && (
        <p>Earliest modeled first harvest is <CalendarMonth month={deadline.earliestPossibleMonth} />. <a href="#latest-first-harvest">Change the deadline</a>.</p>
      )}
    </section>
  );
}

function RankAndScore({ rank, score }: { rank: number; score: number }) {
  return <><strong>Rank {rank}</strong><span>{numberFormat.format(score)} / 100</span></>;
}

export function DryYearResult({ stress, hasDeadline, hasQuota }: { stress: DryYearReplay; hasDeadline: boolean; hasQuota: boolean }) {
  const additionalCalendar = stress.robustPlan?.calendar;

  return (
    <section className={styles.stress} id="rotation-stress-test" aria-labelledby="rotation-stress-test-title">
      <h3 id="rotation-stress-test-title">Dry-year replay</h3>
      <p className={styles.description}>
        <strong>{stress.year}</strong> had the lowest annual precipitation in the {stress.completeYears} years with complete replay data.
        The NASA POWER grid estimate was <strong>{numberFormat.format(stress.precipitationMm)} mm</strong>,
        compared with a median of <strong>{numberFormat.format(stress.medianPrecipitationMm)} mm</strong> across those years.
      </p>
      {stress.plans.length > 0 ? (
        <ul className={styles.plans}>
          {stress.plans.map((plan) => (
            <li className={styles.plan} key={plan.cycles.join("-")}>
              <div className={styles.planName}>
                <h4>{plan.cycles.map((crop) => cropLabels[crop]).join(" → ")}</h4>
                {plan.priorities.length > 0 && <p>{plan.priorities.map((goal) => rotationPriorityLabels[goal]).join(" · ")}</p>}
                {plan.isRobustPick && <p className={styles.robust}>Highest floor score</p>}
              </div>
              <dl className={styles.ranks}>
                <div>
                  <dt>Historical model</dt>
                  <dd><RankAndScore rank={plan.historicalRank} score={plan.historicalScore} /></dd>
                </div>
                <div>
                  <dt>{stress.year} replay</dt>
                  <dd>{plan.dryYearRank !== undefined && plan.dryYearScore !== undefined
                    ? <RankAndScore rank={plan.dryYearRank} score={plan.dryYearScore} />
                    : <span>Excluded in the dry-year run</span>}</dd>
                </div>
              </dl>
              {plan.isRobustPick && additionalCalendar && (
                <details className={styles.calendar}>
                  <summary>Show crop calendar</summary>
                  <ol>
                    {additionalCalendar.schedule.map(({ crop, plantingMonth, harvestMonth }) => (
                      <li key={plantingMonth}>
                        <strong>{rotationCycleLabels[crop]}</strong>
                        <span><CalendarMonth month={plantingMonth} /> – <CalendarMonth month={harvestMonth} /></span>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.description}>The historical model returned no priority plans to replay.</p>
      )}
      <p className={styles.description}>
        The replay repeats {stress.year}’s monthly temperatures and rainfall to test how the model responds. Future conditions and harvests can differ.
      </p>
      {stress.plans.length > 0 && (
        <p className={styles.description}>
          Each rank compares scores across rotations eligible in that run.
          {hasDeadline && " Both runs use the same harvest deadline."}
          {hasQuota && " Both runs use the same seasonal water cap."} Tied scores share a rank.
        </p>
      )}
      {stress.plans.some(({ isRobustPick }) => isRobustPick) && (
        <p className={styles.description}>
          The floor score is the lower of a plan’s two model scores. The highlighted plan has the highest floor score among rotations eligible in both runs.
        </p>
      )}
    </section>
  );
}

