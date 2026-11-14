"use client";

import { useEffect, useId, useState } from "react";
import type { CropId, RecommendResponse, RotationCalendar, RotationCycle } from "@/types/api";
import { rotationCycleLabels } from "./crop-labels";
import { budgetPlan, irrigationSystems, type CycleBudget, type IrrigationSystem } from "./plan-budget";
import { rotationPriorityLabels } from "./rotation-priority-labels";
import styles from "./plan-budget.module.css";

const STORAGE_KEY = "fieldshift:plan-budget:v1";
const moneyFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const waterFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 0 });

const figures = [
  { key: "yieldKgPerDa", label: "Expected yield", unit: "kg/da" },
  { key: "priceTlPerKg", label: "Selling price", unit: "TL/kg" },
  { key: "costTlPerDa", label: "Production cost without irrigation water", unit: "TL/da" },
] as const;

type Figure = (typeof figures)[number]["key"];
interface Saved {
  entries: Partial<Record<RotationCycle, Partial<Record<Figure, string>>>>;
  system: IrrigationSystem;
  waterCost: string;
}

interface PlanBudgetPanelProps {
  result: Pick<RecommendResponse, "suitability" | "rotationComparison" | "rotationStrategies" | "rotationStressTest">;
  irrigated: boolean;
}

function readSaved(): Saved {
  const empty: Saved = { entries: {}, system: "sprinkler", waterCost: "" };
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof saved !== "object" || saved === null) return empty;
    const { entries, system, waterCost } = saved as Partial<Saved>;
    return {
      entries: typeof entries === "object" && entries !== null ? entries : {},
      system: system !== undefined && system in irrigationSystems ? system : "sprinkler",
      waterCost: typeof waterCost === "string" ? waterCost : "",
    };
  } catch {
    return empty;
  }
}

function amount(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function Money({ value }: { value: number }) {
  return <>{moneyFormat.format(value)} TL/da</>;
}

export default function PlanBudgetPanel({ result, irrigated }: PlanBudgetPanelProps) {
  const [saved, setSaved] = useState<Saved>(readSaved);
  const titleId = useId();

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Private browsing can block storage. The entries then last for this visit.
    }
  }, [saved]);

  const plans: { key: string; label: string; calendar: RotationCalendar }[] = [];
  const addPlan = (label: string, calendar: RotationCalendar) => {
    const key = calendar.schedule.map(({ crop }) => crop).join(",");
    if (!plans.some((plan) => plan.key === key)) plans.push({ key, label, calendar });
  };
  if (result.rotationComparison) addPlan("Current rotation", result.rotationComparison.current);
  for (const { priorities, calendar } of result.rotationStrategies ?? []) {
    addPlan(priorities.map((priority) => rotationPriorityLabels[priority]).join(" · "), calendar);
  }
  if (result.rotationStressTest?.robustPlan) addPlan("Best across both scenarios", result.rotationStressTest.robustPlan.calendar);
  if (plans.length === 0) return null;

  const used = new Set(plans.flatMap(({ calendar }) => calendar.schedule.map(({ crop }) => crop)));
  const cycles = (Object.keys(rotationCycleLabels) as RotationCycle[]).filter((cycle) => used.has(cycle));
  const water = new Map(result.suitability.map(({ crop, water }) => [crop, water]));
  const netIrrigationMm: Partial<Record<CropId, number>> = {};
  for (const [crop, balance] of water) {
    if (balance) netIrrigationMm[crop] = balance.netIrrigationRequirementMm;
  }
  const entries: Partial<Record<RotationCycle, CycleBudget>> = {};
  for (const cycle of cycles) {
    const entry = saved.entries[cycle];
    entries[cycle] = {
      yieldKgPerDa: amount(entry?.yieldKgPerDa),
      priceTlPerKg: amount(entry?.priceTlPerKg),
      costTlPerDa: amount(entry?.costTlPerDa),
    };
  }
  const irrigation = irrigated ? { system: saved.system, waterCostTlPerM3: amount(saved.waterCost) } : undefined;

  function setFigure(cycle: RotationCycle, figure: Figure, value: string) {
    setSaved((current) => ({
      ...current,
      entries: { ...current.entries, [cycle]: { ...current.entries[cycle], [figure]: value } },
    }));
  }

  return (
    <section className={styles.budget} id="budget" aria-labelledby={titleId}>
      <h2 id={titleId}>Costs and returns</h2>
      <p className={styles.description}>
        Compare gross margin per decare using your own yields, prices and costs. The fields start empty because prices and input
        costs change every season. FieldShift adds the irrigation volume from its water balance. Entries stay in this browser.
      </p>

      <div className={styles.entries}>
        {cycles.map((cycle) => {
          const balance = cycle === "fallow" ? undefined : water.get(cycle);
          return (
            <fieldset className={styles.entry} key={cycle}>
              <legend>{rotationCycleLabels[cycle]}</legend>
              {figures.filter(({ key }) => cycle !== "fallow" || key === "costTlPerDa").map(({ key, label, unit }) => (
                <label key={key}>
                  <span>{cycle === "fallow" && key === "costTlPerDa" ? "Fallow cost, such as tillage" : label}</span>
                  <span className={styles.field}>
                    <input type="number" min="0" step="any" inputMode="decimal" value={saved.entries[cycle]?.[key] ?? ""}
                      aria-label={`${rotationCycleLabels[cycle]}: ${label.toLowerCase()} in ${unit}`}
                      onChange={(event) => setFigure(cycle, key, event.target.value)} />
                    <span>{unit}</span>
                  </span>
                </label>
              ))}
              {balance && (
                <p>
                  {irrigated
                    ? <>Model: {waterFormat.format(balance.netIrrigationRequirementMm)} m³/da of irrigation at the root zone per season.</>
                    : <>Model: about {percentFormat.format(balance.rainfedRelativeYield)} of the fully watered yield without irrigation.</>}
                </p>
              )}
            </fieldset>
          );
        })}
        {irrigated && (
          <fieldset className={styles.entry}>
            <legend>Irrigation</legend>
            <label>
              <span>Irrigation system</span>
              <select value={saved.system}
                onChange={(event) => setSaved((current) => ({ ...current, system: event.target.value as IrrigationSystem }))}>
                {Object.entries(irrigationSystems).map(([id, { label, efficiency }]) => (
                  <option key={id} value={id}>{label}, {percentFormat.format(efficiency)} reaches the roots</option>
                ))}
              </select>
            </label>
            <label>
              <span>Pumping and water cost</span>
              <span className={styles.field}>
                <input type="number" min="0" step="any" inputMode="decimal" value={saved.waterCost}
                  aria-label="Pumping and water cost in TL/m³"
                  onChange={(event) => setSaved((current) => ({ ...current, waterCost: event.target.value }))} />
                <span>TL/m³</span>
              </span>
            </label>
          </fieldset>
        )}
      </div>

      <ul className={styles.plans} aria-live="polite">
        {plans.map(({ key, label, calendar }) => {
          const outcome = budgetPlan(calendar, entries, { netIrrigationMm, irrigation });
          return (
            <li className={styles.plan} key={key}>
              <h3>{label}</h3>
              <p className={styles.sequence}>
                {calendar.schedule.map(({ crop }) => rotationCycleLabels[crop]).join(" → ")} · {calendar.totalMonths} months
              </p>
              {outcome.status === "incomplete" ? (
                <p className={styles.pending}>
                  Enter {outcome.missing.map((item) => item in rotationCycleLabels
                    ? `${rotationCycleLabels[item as RotationCycle].toLowerCase()} figures`
                    : item).join(", ")} to see this plan.
                </p>
              ) : (
                <dl className={styles.metrics}>
                  <div><dt>Revenue</dt><dd><Money value={outcome.budget.revenueTlPerDa} /></dd></div>
                  <div><dt>Production cost</dt><dd><Money value={outcome.budget.productionCostTlPerDa} /></dd></div>
                  {irrigated && (
                    <div>
                      <dt>Irrigation, {waterFormat.format(outcome.budget.irrigationWaterM3PerDa)} m³/da pumped</dt>
                      <dd><Money value={outcome.budget.irrigationCostTlPerDa} /></dd>
                    </div>
                  )}
                  <div className={styles.margin} data-loss={outcome.budget.grossMarginTlPerDa < 0 || undefined}>
                    <dt>Gross margin</dt>
                    <dd><Money value={outcome.budget.grossMarginTlPerDa} /></dd>
                  </div>
                  <div className={styles.margin} data-loss={outcome.budget.grossMarginTlPerDa < 0 || undefined}>
                    <dt>Gross margin per year</dt>
                    <dd><Money value={outcome.budget.grossMarginTlPerDaPerYear} /></dd>
                  </div>
                </dl>
              )}
            </li>
          );
        })}
      </ul>

      <p className={styles.description}>
        Gross margin is revenue minus production and irrigation costs over the three cycles. The yearly figure spreads it over
        each plan’s months, so plans of different length compare fairly. Land rent, machinery depreciation and support payments
        count only if you include them in production cost.
        {irrigated && (
          <> Pumped water is the modeled irrigation at the root zone divided by the system’s{" "}
            <a href="https://www.fao.org/4/t7202e/t7202e08.htm" target="_blank" rel="noreferrer">indicative FAO application efficiency</a>.</>
        )}
      </p>
    </section>
  );
}
