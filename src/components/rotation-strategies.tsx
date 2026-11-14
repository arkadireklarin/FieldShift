"use client";

import { useId, useState } from "react";
import type { RotationCalendar, RotationPriority, RotationStrategy } from "@/types/api";
import { rotationCycleLabels } from "./crop-labels";
import { rotationPriorityLabels } from "./rotation-priority-labels";
import styles from "./rotation-strategies.module.css";

const priorities = Object.keys(rotationPriorityLabels) as RotationPriority[];
const monthFormat = new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" });
const scoreFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const listFormat = new Intl.ListFormat("en", { type: "conjunction" });

function CalendarMonth({ month }: { month: string }) {
  return <time dateTime={month}>{monthFormat.format(new Date(`${month}-01T00:00:00Z`))}</time>;
}

function firstHarvestMonth(calendar: RotationCalendar) {
  return calendar.schedule.find(({ crop }) => crop !== "fallow")?.harvestMonth;
}

function monthIndex(month: string) {
  const [year, monthOfYear] = month.split("-").map(Number);
  return year * 12 + monthOfYear;
}

function compareWithHighestScore(strategy: RotationStrategy, highestScore: RotationStrategy) {
  const firstHarvest = firstHarvestMonth(strategy.calendar);
  const referenceHarvest = firstHarvestMonth(highestScore.calendar);
  const differences: string[] = [];

  if (firstHarvest && referenceHarvest && firstHarvest !== referenceHarvest) {
    const months = monthIndex(firstHarvest) - monthIndex(referenceHarvest);
    const count = Math.abs(months);
    differences.push(`the first harvest is ${count} ${count === 1 ? "month" : "months"} ${months < 0 ? "earlier" : "later"}`);
  }

  const scoreGap = Math.round((highestScore.plan.score - strategy.plan.score) * 10) / 10;
  if (scoreGap > 0) {
    differences.push(`the model score is ${scoreFormat.format(scoreGap)} ${scoreGap === 1 ? "point" : "points"} lower`);
  }

  const extraFamilies = strategy.calendar.distinctFamilyCount - highestScore.calendar.distinctFamilyCount;
  if (extraFamilies > 0) {
    differences.push(`the rotation includes ${extraFamilies} more crop ${extraFamilies === 1 ? "family" : "families"}`);
  }

  return listFormat.format(differences);
}

export default function RotationStrategies({ strategies }: { strategies: readonly RotationStrategy[] }) {
  const [priority, setPriority] = useState<RotationPriority | "all">("all");
  const controlName = useId();
  const availablePriorities = priorities.filter((goal) => strategies.some(({ priorities }) => priorities.includes(goal)));
  const activePriority = priority === "all" || availablePriorities.includes(priority) ? priority : "all";
  const highlighted = strategies.find(({ priorities }) => activePriority !== "all" && priorities.includes(activePriority));
  const highestScore = strategies.find(({ priorities }) => priorities.includes("historical-fit"));

  if (strategies.length === 0) return null;

  return (
    <section className={styles.strategies} id="rotation-strategies" aria-labelledby="rotation-strategies-title">
      <h3 id="rotation-strategies-title">Compare plans by priority</h3>
      <p className={styles.description}>
        Choose a priority to highlight its plan. A single plan can meet several priorities.
      </p>
      <fieldset className={styles.priorities}>
        <legend>Choose a priority</legend>
        <label>
          <input type="radio" name={controlName} checked={activePriority === "all"} onChange={() => setPriority("all")} />
          Compare all
        </label>
        {availablePriorities.map((goal) => (
          <label key={goal}>
            <input type="radio" name={controlName} checked={activePriority === goal} onChange={() => setPriority(goal)} />
            {rotationPriorityLabels[goal]}
          </label>
        ))}
      </fieldset>
      <ul className={styles.cards}>
        {strategies.map((strategy) => {
          const { priorities, plan, calendar } = strategy;
          const firstHarvest = firstHarvestMonth(calendar);
          const tradeoff = highestScore && compareWithHighestScore(strategy, highestScore);

          return (
            <li className={styles.card} key={plan.cycles.join("-")} aria-current={highlighted === strategy || undefined}>
              <h4>{priorities.map((goal) => rotationPriorityLabels[goal]).join(" · ")}</h4>
              <ol className={styles.cycles} aria-label="Crop cycles in order">
                {calendar.schedule.map(({ crop, plantingMonth, harvestMonth }) => (
                  <li key={plantingMonth}>
                    <strong>{rotationCycleLabels[crop]}</strong>
                    <span><CalendarMonth month={plantingMonth} /> – <CalendarMonth month={harvestMonth} /></span>
                  </li>
                ))}
              </ol>
              <dl className={styles.metrics}>
                <div><dt>First harvest</dt><dd>{firstHarvest ? <CalendarMonth month={firstHarvest} /> : "None"}</dd></div>
                <div><dt>Crop families</dt><dd>{calendar.distinctFamilyCount}</dd></div>
                <div><dt>Model score</dt><dd>{scoreFormat.format(plan.score)} / 100</dd></div>
                <div><dt>Time to finish</dt><dd>{calendar.totalMonths} months</dd></div>
              </dl>
              {tradeoff && <p className={styles.description}>Compared with the highest-scoring plan, {tradeoff}.</p>}
              {plan.explanations[0] && (
                <details className={styles.explanation}>
                  <summary>Why this first crop?</summary>
                  <p>{plan.explanations[0]}</p>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      <p className={styles.description}>
        Model scores are relative and use historical climate, crop profiles and rules for crop transitions and family diversity.
        Dates use provisional planting and harvest windows.
      </p>
    </section>
  );
}
