import { describe, expect, it } from "vitest";
import type { ClimateMonth, ClimateSummary, FieldSelection } from "../../types/api";
import { getCropProfile } from "../crops/profiles";
import { analyzeRotations, rankRotations } from "./index";

const field: FieldSelection = {
  location: { lat: 37.57, lon: 32.77 },
  previousCrop: "wheat",
  irrigation: "unavailable",
};

function historicalFixture(temperatureC = 20, monthlyRainMm = 40): ClimateSummary {
  const months: ClimateMonth[] = [];
  for (const year of [2024, 2025]) {
    for (let month = 1; month <= 12; month++) {
      const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
      months.push({
        month: `${year}-${String(month).padStart(2, "0")}`,
        meanTemperatureC: temperatureC,
        totalPrecipitationMm: monthlyRainMm,
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
    expect(rainfed[0].transitions[0].from).toBe("wheat");
    expect(afterLegume[0].transitions[0].from).toBe("chickpea");
    expect(afterLegume.map(({ cycles, score }) => [cycles, score])).not.toEqual(rainfed.map(({ cycles, score }) => [cycles, score]));
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

  it("requires complete temperature evidence and excludes crops with zero modeled temperature fit", () => {
    const start = { year: 2026, month: 12 };
    expect(rankRotations(historicalFixture(-30), field, start)).toEqual([]);
    const climate = historicalFixture();
    for (const month of climate.months) {
      month.meanTemperatureC = null;
      month.temperatureDays = 0;
    }
    expect(rankRotations(climate, field, start)).toEqual([]);
  });

  it("withholds rainfed plans with zero seasonal water supply", () => {
    expect(rankRotations(historicalFixture(20, 0), field, { year: 2026, month: 12 })).toEqual([]);
  });
});

describe("rotation search priorities", () => {
  const start = { year: 2027, month: 1 };

  it("finds earlier harvest and more diverse choices outside the highest three scores", () => {
    const climate = historicalFixture(9, 45);
    const irrigatedField = { ...field, previousCrop: "sunflower", irrigation: "available" } as const;
    const { rotations, strategies } = analyzeRotations(climate, irrigatedField, start);
    expect(rotations).toEqual(rankRotations(climate, irrigatedField, start));
    expect(strategies.map(({ priorities }) => priorities)).toEqual([
      ["historical-fit"], ["early-harvest"], ["family-diversity"],
    ]);

    const [historical, early, diverse] = strategies;
    expect(historical.plan).toEqual(rotations[0]);
    expect(historical.calendar.schedule[0].harvestMonth).toBe("2028-07");
    expect(rotations).not.toContainEqual(early.plan);
    expect(early.plan.cycles).toEqual(["lentil", "barley", "chickpea"]);
    expect(early.calendar.schedule[0].harvestMonth).toBe("2027-07");
    expect(early.calendar.totalMonths).toBe(32);
    expect(rotations).not.toContainEqual(diverse.plan);
    expect(diverse.plan.cycles).toEqual(["lentil", "barley", "sunflower"]);
    expect(diverse.calendar.distinctFamilyCount).toBe(3);
    expect(diverse.calendar.schedule.map(({ crop }) => crop)).toEqual(diverse.plan.cycles);
  });

  it("groups all priorities when the same sequence wins", () => {
    const { rotations, strategies } = analyzeRotations(historicalFixture(35), { ...field, irrigation: "available" }, start);
    expect(strategies).toHaveLength(1);
    expect(strategies[0].priorities).toEqual(["historical-fit", "early-harvest", "family-diversity"]);
    expect(strategies[0].plan).toEqual(rotations[0]);
  });

  it("returns no priority winners when there are no eligible rotations", () => {
    expect(analyzeRotations(historicalFixture(-30), field, start)).toEqual({ rotations: [], strategies: [] });
  });

  it("replays the driest year with the same deadline and shares ranks across tied scores", () => {
    const climate = historicalFixture(20, 20);
    for (const month of climate.months) {
      if (month.month.startsWith("2025")) month.totalPrecipitationMm = 5;
    }
    const fieldWithDeadline = { ...field, latestFirstHarvest: "2027-07", irrigation: "available" } as const;
    const result = analyzeRotations(climate, fieldWithDeadline, start);
    expect(result.harvestDeadline).toEqual({
      month: "2027-07", matchingCount: 20, candidateCount: 120, earliestPossibleMonth: "2027-07",
    });
    expect(result.rotationStressTest).toMatchObject({ year: 2025, precipitationMm: 60, medianPrecipitationMm: 150 });
    const replay = result.rotationStressTest!;
    const pick = replay.plans.find(({ isRobustPick }) => isRobustPick)!;
    expect(pick.dryYearScore).toBeLessThan(pick.historicalScore);
    expect(replay.plans.filter(({ isRobustPick }) => isRobustPick)).toHaveLength(1);
    for (const entry of replay.plans) {
      if (entry.historicalScore === pick.historicalScore) expect(entry.historicalRank).toBe(pick.historicalRank);
      if (entry.dryYearScore === pick.dryYearScore) expect(entry.dryYearRank).toBe(pick.dryYearRank);
    }
    expect(result.strategies.every(({ calendar }) => calendar.schedule[0].harvestMonth <= "2027-07")).toBe(true);
  });

  it("checks the same candidates against historical and replay quotas without hiding the calendar baseline", () => {
    const climate = historicalFixture(20, 50);
    for (const month of climate.months) {
      if (month.month.startsWith("2025")) month.totalPrecipitationMm = 15;
    }
    const fieldWithQuota = {
      ...field, latestFirstHarvest: "2027-07", irrigation: "available", irrigationQuotaM3PerDa: 350,
    } as const;
    const result = analyzeRotations(climate, fieldWithQuota, start);
    expect(result.irrigationQuota).toMatchObject({ candidateCount: 20, matchingCount: 0, dryYearMatchingCount: 0 });
    expect(result.irrigationQuota?.minimumRequiredM3PerDa).toBeGreaterThan(350);
    expect(result.calendarBenchmark).toMatchObject({ baseline: { meetsDeadline: true, fitsQuota: true, dryYearFitsQuota: false } });
    expect(result.calendarBenchmark?.selected).toBeUndefined();
    expect(result.rotations).toEqual([]);

    const relaxed = analyzeRotations(climate, { ...fieldWithQuota, irrigationQuotaM3PerDa: 600 }, start);
    expect(relaxed.rotations.length).toBeGreaterThan(0);
    expect(relaxed.calendarBenchmark?.selected?.dryYearWaterM3PerDa).toBeLessThanOrEqual(600);
    expect(relaxed.calendarBenchmark?.baseline.calendar).toEqual(result.calendarBenchmark?.baseline.calendar);
  });
});
