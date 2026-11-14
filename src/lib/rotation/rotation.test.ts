import { describe, expect, it } from "vitest";
import type { ClimateMonth, ClimateSummary, FieldSelection } from "../../types/api";
import snapshot from "../../data/validation/konya-nasa-power-2021-2025.json";
import { CROP_PROFILES, getCropProfile } from "../crops/profiles";
import { assessCropSuitability } from "../crops/suitability";
import { analyzeRotations, compareRotationCalendars, rankRotations } from "./index";
import { buildSoilAssessment, buildSoilHealthComparison } from "./soil-sensitivity";

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

  it("changes water storage, suitability and top rotation when a single local soil input changes on the Konya NASA record", () => {
    const konyaClimate: ClimateSummary = {
      months: snapshot.months,
      provenance: {
        ...snapshot.provenance,
        kind: "nasa_power",
        source: "NASA POWER",
        spatialScope: "grid_cell",
        parameters: ["T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR"],
      },
      limitations: [],
    };
    const baseField: FieldSelection = {
      location: { lat: 37.5667, lon: 32.775 },
      previousCrop: "wheat",
      irrigation: "unavailable",
      currentRotation: ["wheat", "fallow", "wheat"],
    };
    const shallowField: FieldSelection = { ...baseField, rootingDepthCm: 50 };
    const previous = getCropProfile(baseField.previousCrop);
    const shallowSuitability = CROP_PROFILES.map((crop) => assessCropSuitability(crop, konyaClimate, shallowField, previous));
    const shallowAnalysis = analyzeRotations(konyaClimate, shallowField, start);
    const assessment = buildSoilAssessment(konyaClimate, shallowField, start, shallowSuitability, shallowAnalysis);

    expect(assessment.baselineComparison.hasLocalSoilInputs).toBe(true);
    const chickpeaChange = assessment.baselineComparison.cropChanges.find(({ crop }) => crop === "chickpea")!;
    const wheatChange = assessment.baselineComparison.cropChanges.find(({ crop }) => crop === "wheat")!;
    // Chickpea relies on winter rain stored before March planting, so a 50 cm (65 mm) cap lowers its stored water and score
    expect(chickpeaChange.baselineStorageCapMm).toBe(130);
    expect(chickpeaChange.currentStorageCapMm).toBe(65);
    expect(chickpeaChange.currentStoredWaterMm!).toBeLessThan(chickpeaChange.baselineStoredWaterMm!);
    expect(chickpeaChange.currentNetIrrigationMm!).toBeGreaterThan(chickpeaChange.baselineNetIrrigationMm!);
    expect(chickpeaChange.currentScore!).toBeLessThan(chickpeaChange.baselineScore!);
    // Autumn-sown wheat uses winter rain in-season; its Aug-Sep preseason recharge is below 65 mm so its stored water is unchanged
    expect(wheatChange.currentStoredWaterMm).toBeCloseTo(wheatChange.baselineStoredWaterMm!);

    // On an irrigated field (where all 6 crops compete), changing a single soil input (pH or root depth) shifts crop scores and top plans
    const irrigatedBase: FieldSelection = {
      location: { lat: 37.5667, lon: 32.775 },
      previousCrop: "sunflower",
      irrigation: "available",
      measuredSoilPh: 5.6,
    };
    const irrigatedSuitability = CROP_PROFILES.map((crop) =>
      assessCropSuitability(crop, konyaClimate, irrigatedBase, getCropProfile(irrigatedBase.previousCrop)),
    );
    const irrigatedAnalysis = analyzeRotations(konyaClimate, irrigatedBase, { year: 2026, month: 12 });
    const irrigatedAssessment = buildSoilAssessment(
      konyaClimate,
      irrigatedBase,
      { year: 2026, month: 12 },
      irrigatedSuitability,
      irrigatedAnalysis,
    );
    expect(irrigatedAssessment.baselineComparison.hasLocalSoilInputs).toBe(true);
    expect(irrigatedAssessment.baselineComparison.cropChanges.some((c) => c.baselineScore !== c.currentScore)).toBe(true);
    expect(irrigatedAssessment.singleInputChecks).toHaveLength(3);

    // Holding all other inputs fixed near Çumra, changing only rootingDepthCm to 50 cm pushes chickpea irrigation from 190 to 255 m³/da (above the 210 m³/da cap) and flips the top plan
    const cumraLikeClimate = historicalFixture(20, 40);
    const cumraQuotaField: FieldSelection = {
      location: { lat: 37.5667, lon: 32.775 },
      previousCrop: "wheat",
      irrigation: "available",
      irrigationQuotaM3PerDa: 210,
      rootingDepthCm: 50,
    };
    const cumraSuitability = CROP_PROFILES.map((crop) =>
      assessCropSuitability(crop, cumraLikeClimate, cumraQuotaField, getCropProfile(cumraQuotaField.previousCrop)),
    );
    const cumraAnalysis = analyzeRotations(cumraLikeClimate, cumraQuotaField, { year: 2026, month: 12 });
    const cumraAssessment = buildSoilAssessment(
      cumraLikeClimate,
      cumraQuotaField,
      { year: 2026, month: 12 },
      cumraSuitability,
      cumraAnalysis,
    );
    expect(cumraAssessment.baselineComparison.topPlanChanged).toBe(true);
    expect(cumraAssessment.baselineComparison.baselineQuotaMatchingCount).toBeGreaterThan(
      cumraAssessment.baselineComparison.currentQuotaMatchingCount!,
    );

    const comparison = compareRotationCalendars(baseField.currentRotation!, shallowAnalysis.rotations, start);
    const soilHealth = buildSoilHealthComparison(
      baseField.previousCrop,
      comparison,
      shallowAnalysis.rotations,
      shallowAnalysis.strategies,
    );
    expect(soilHealth.current?.sameFamilyTransitions).toBe(2);
    expect(soilHealth.current?.sameCropTransitions).toBe(2);
    expect(soilHealth.current?.fallowMonths).toBe(12);
    expect(soilHealth.current?.uncroppedMonths).toBe(23);
    expect(soilHealth.recommended[0].sameFamilyTransitions).toBeLessThan(soilHealth.current!.sameFamilyTransitions);
    expect(soilHealth.recommended[0].uncroppedMonths).toBeLessThan(soilHealth.current!.uncroppedMonths);
    expect(soilHealth.requiredFieldEvidence).toHaveLength(3);
  });
});
