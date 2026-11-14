import type { CropId, RotationCalendar, RotationCycle } from "@/types/api";

/** Indicative field application efficiencies from FAO Irrigation Water Management, Irrigation Scheduling, Annex I. */
export const irrigationSystems = {
  surface: { label: "Surface (furrow, border, basin)", efficiency: 0.6 },
  sprinkler: { label: "Sprinkler", efficiency: 0.75 },
  drip: { label: "Drip", efficiency: 0.9 },
} as const;

export type IrrigationSystem = keyof typeof irrigationSystems;

/** The grower's own figures for one crop or for fallow. Null marks a blank entry. */
export interface CycleBudget {
  yieldKgPerDa: number | null;
  priceTlPerKg: number | null;
  /** Seed, fertilizer, fuel, labor and other costs, without irrigation water. */
  costTlPerDa: number | null;
}

export interface PlanBudgetOptions {
  /** Modeled net irrigation at the root zone per crop season in mm, which equals m³ per decare. */
  netIrrigationMm: Partial<Record<CropId, number>>;
  /** Present on irrigated fields only. */
  irrigation?: { system: IrrigationSystem; waterCostTlPerM3: number | null };
}

export interface PlanBudget {
  /** Pumped water across the three cycles, after application losses. Zero on rainfed fields. */
  irrigationWaterM3PerDa: number;
  revenueTlPerDa: number;
  productionCostTlPerDa: number;
  irrigationCostTlPerDa: number;
  grossMarginTlPerDa: number;
  /** Gross margin spread over the plan's months, so plans of different length compare fairly. */
  grossMarginTlPerDaPerYear: number;
}

export type PlanBudgetResult =
  | { status: "complete"; budget: PlanBudget }
  | { status: "incomplete"; missing: string[] };

/** A fallow cycle earns nothing and uses no irrigation. Its cost counts as zero when left blank. */
export function budgetPlan(
  calendar: RotationCalendar,
  entries: Partial<Record<RotationCycle, CycleBudget>>,
  { netIrrigationMm, irrigation }: PlanBudgetOptions,
): PlanBudgetResult {
  const missing = new Set<string>();
  let revenue = 0;
  let productionCost = 0;
  let water = 0;

  for (const { crop } of calendar.schedule) {
    const entry = entries[crop];
    if (crop === "fallow") {
      productionCost += entry?.costTlPerDa ?? 0;
      continue;
    }
    if (entry?.yieldKgPerDa == null || entry.priceTlPerKg == null || entry.costTlPerDa == null) {
      missing.add(crop);
      continue;
    }
    revenue += entry.yieldKgPerDa * entry.priceTlPerKg;
    productionCost += entry.costTlPerDa;
    if (irrigation) {
      const net = netIrrigationMm[crop];
      if (net === undefined) missing.add(`${crop} water estimate`);
      else water += net / irrigationSystems[irrigation.system].efficiency;
    }
  }
  if (irrigation && water > 0 && irrigation.waterCostTlPerM3 === null) missing.add("water cost");
  if (missing.size > 0) return { status: "incomplete", missing: [...missing] };

  const irrigationCost = water * (irrigation?.waterCostTlPerM3 ?? 0);
  const grossMargin = revenue - productionCost - irrigationCost;
  return {
    status: "complete",
    budget: {
      irrigationWaterM3PerDa: water,
      revenueTlPerDa: revenue,
      productionCostTlPerDa: productionCost,
      irrigationCostTlPerDa: irrigationCost,
      grossMarginTlPerDa: grossMargin,
      grossMarginTlPerDaPerYear: grossMargin * 12 / calendar.totalMonths,
    },
  };
}
