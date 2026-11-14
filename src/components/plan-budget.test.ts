import { describe, expect, it } from "vitest";
import type { RotationCalendar } from "@/types/api";
import { budgetPlan } from "./plan-budget";

function calendar(crops: RotationCalendar["schedule"][number]["crop"][], totalMonths: number): RotationCalendar {
  return {
    schedule: crops.map((crop, index) => ({ crop, plantingMonth: `202${7 + index}-03`, harvestMonth: `202${7 + index}-08` })),
    totalMonths,
    uncroppedMonths: 0,
    distinctCropCount: 0,
    distinctFamilyCount: 0,
  };
}

const entries = {
  wheat: { yieldKgPerDa: 300, priceTlPerKg: 10, costTlPerDa: 1200 },
  chickpea: { yieldKgPerDa: 120, priceTlPerKg: 40, costTlPerDa: 1500 },
  lentil: { yieldKgPerDa: 100, priceTlPerKg: 50, costTlPerDa: 1400 },
};
const netIrrigationMm = { wheat: 300, chickpea: 270, lentil: 90 };

describe("plan budget", () => {
  it("adds revenue and costs across cycles and spreads the margin over the plan length", () => {
    const result = budgetPlan(calendar(["chickpea", "wheat", "lentil"], 30), entries, { netIrrigationMm });

    expect(result).toEqual({
      status: "complete",
      budget: {
        irrigationWaterM3PerDa: 0,
        revenueTlPerDa: 12_800,
        productionCostTlPerDa: 4100,
        irrigationCostTlPerDa: 0,
        grossMarginTlPerDa: 8700,
        grossMarginTlPerDaPerYear: 3480,
      },
    });
  });

  it("charges pumped water on irrigated fields after application losses", () => {
    const result = budgetPlan(calendar(["chickpea", "wheat", "lentil"], 36), entries, {
      netIrrigationMm, irrigation: { system: "sprinkler", waterCostTlPerM3: 2 },
    });

    expect(result).toMatchObject({
      status: "complete",
      budget: { irrigationWaterM3PerDa: 880, irrigationCostTlPerDa: 1760, grossMarginTlPerDa: 6940 },
    });
    const drip = budgetPlan(calendar(["chickpea", "wheat", "lentil"], 36), entries, {
      netIrrigationMm, irrigation: { system: "drip", waterCostTlPerM3: 2 },
    });
    expect(drip).toMatchObject({ budget: { irrigationWaterM3PerDa: expect.closeTo(733.33, 2) } });
  });

  it("treats fallow as a cost-only cycle without irrigation", () => {
    const result = budgetPlan(calendar(["wheat", "fallow", "wheat"], 44), {
      ...entries, fallow: { yieldKgPerDa: null, priceTlPerKg: null, costTlPerDa: 300 },
    }, { netIrrigationMm, irrigation: { system: "surface", waterCostTlPerM3: 1 } });

    expect(result).toMatchObject({
      status: "complete",
      budget: { revenueTlPerDa: 6000, productionCostTlPerDa: 2700, irrigationWaterM3PerDa: 1000, grossMarginTlPerDa: 2300 },
    });
    expect(budgetPlan(calendar(["fallow", "fallow", "fallow"], 36), {}, { netIrrigationMm }))
      .toMatchObject({ status: "complete", budget: { grossMarginTlPerDa: 0 } });
  });

  it("withholds a margin until every figure it depends on is entered", () => {
    const plan = calendar(["chickpea", "wheat", "lentil"], 36);

    expect(budgetPlan(plan, { ...entries, wheat: { ...entries.wheat, priceTlPerKg: null } }, { netIrrigationMm }))
      .toEqual({ status: "incomplete", missing: ["wheat"] });
    expect(budgetPlan(plan, entries, { netIrrigationMm, irrigation: { system: "drip", waterCostTlPerM3: null } }))
      .toEqual({ status: "incomplete", missing: ["water cost"] });
    expect(budgetPlan(plan, entries, { netIrrigationMm: { wheat: 300 }, irrigation: { system: "drip", waterCostTlPerM3: 2 } }))
      .toEqual({ status: "incomplete", missing: ["chickpea water estimate", "lentil water estimate"] });
  });
});
