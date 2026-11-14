import { describe, expect, it } from "vitest";
import type { ClimateMonth, ClimateSummary, FieldSelection } from "../../types/api";
import { getCropProfile } from "../crops/profiles";
import { rankRotations } from "./index";

const field: FieldSelection = {
  location: { lat: 37.57, lon: 32.77 },
  previousCrop: "wheat",
  irrigation: "unavailable",
};

function historicalFixture(temperatureC = 20): ClimateSummary {
  const months: ClimateMonth[] = [];
  for (const year of [2024, 2025]) {
    for (let month = 1; month <= 12; month++) {
      const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
      months.push({
        month: `${year}-${String(month).padStart(2, "0")}`,
        meanTemperatureC: temperatureC,
        totalPrecipitationMm: 20,
        expectedDays: days,
        temperatureDays: days,
        precipitationDays: days,
      });
    }
  }
  return {
    months,
    provenance: {
      kind: "nasa_power",
      source: "NASA POWER",
      sourceUrl: "https://example.com/climate-fixture",
      requestedLocation: field.location,
      retrievedAt: "2026-01-01T00:00:00Z",
      period: { start: "2024-01-01", end: "2025-12-31" },
      spatialScope: "grid_cell",
      parameters: ["T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR"],
    },
    limitations: [],
  };
}

describe("three-cycle rankings", () => {
  it("returns three distinct plans in deterministic weighted score order", () => {
    const climate = historicalFixture();
    const start = { year: 2026, month: 11 };
    const result = rankRotations(climate, field, start);
    expect(result).toEqual(rankRotations({ ...climate, months: [...climate.months].reverse() }, field, start));
    expect(result).toHaveLength(3);
    expect(new Set(result.map(({ cycles }) => cycles.join(","))).size).toBe(3);
    expect(result.map(({ score }) => score)).toEqual(result.map(({ score }) => score).sort((a, b) => b - a));

    for (const plan of result) {
      expect(new Set(plan.cycles).size).toBe(3);
      expect(plan.score).toBeGreaterThanOrEqual(0);
      expect(plan.score).toBeLessThanOrEqual(100);
      expect(plan.score).toBeCloseTo(plan.components.reduce((sum, part) => sum + part.score * part.weight, 0), 1);
      expect(plan.schedule.map(({ crop }) => crop)).toEqual(plan.cycles);
      expect(plan.transitions.map(({ from }) => from)).toEqual([field.previousCrop, ...plan.cycles.slice(0, 2)]);
      expect(plan.transitions.map(({ to }) => to)).toEqual(plan.cycles);
    }
  });

  it("updates the ranked plans for irrigation and the previous crop family", () => {
    const climate = historicalFixture();
    const start = { year: 2026, month: 12 };
    const rainfed = rankRotations(climate, field, start);
    const irrigated = rankRotations(climate, { ...field, irrigation: "available" }, start);
    const afterLegume = rankRotations(climate, { ...field, previousCrop: "chickpea" }, start);

    expect(irrigated[0].score).toBeGreaterThan(rainfed[0].score);
    expect(rainfed[0].transitions[0].code).toBe("CEREAL_TO_LEGUME");
    expect(afterLegume[0].transitions[0].code).toBe("LEGUME_TO_CEREAL");
    expect(afterLegume[0].cycles[0]).not.toBe(rainfed[0].cycles[0]);
  });

  it("waits for the next legal planting window and avoids overlap with winter harvests", () => {
    const result = rankRotations(historicalFixture(), field, { year: 2026, month: 12 });
    const cycles = result.flatMap(({ schedule }) => schedule);
    expect(cycles.some(({ crop }) => getCropProfile(crop).category === "cereal")).toBe(true);

    for (const plan of result) {
      let lastHarvest = "2026-11";
      for (const cycle of plan.schedule) {
        const { plantingStartMonth, plantingEndMonth, growingEndMonth } = getCropProfile(cycle.crop).calendar;
        const plantingMonth = Number(cycle.plantingMonth.slice(5));
        expect(plantingMonth).toBeGreaterThanOrEqual(plantingStartMonth);
        expect(plantingMonth).toBeLessThanOrEqual(plantingEndMonth);
        expect(Number(cycle.harvestMonth.slice(5))).toBe(growingEndMonth);
        expect(cycle.plantingMonth > lastHarvest).toBe(true);
        expect(cycle.harvestMonth > cycle.plantingMonth).toBe(true);
        lastHarvest = cycle.harvestMonth;
      }
    }
  });

  it("omits plans when fewer than three crops can be scored", () => {
    const climate = historicalFixture();
    expect(rankRotations({ ...climate, months: climate.months.slice(0, 1) }, field, { year: 2026, month: 12 })).toEqual([]);
  });

  it("excludes crops with zero modeled temperature fit but allows missing temperature", () => {
    const start = { year: 2026, month: 12 };
    expect(rankRotations(historicalFixture(-30), field, start)).toEqual([]);
    const climate = historicalFixture();
    for (const month of climate.months) {
      month.meanTemperatureC = null;
      month.temperatureDays = 0;
    }
    expect(rankRotations(climate, field, start)).toHaveLength(3);
  });
});
