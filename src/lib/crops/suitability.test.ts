import { describe, expect, it } from "vitest";
import type { ClimateMonth } from "../../types/api";
import snapshot from "../../data/validation/konya-nasa-power-2021-2025.json";
import { CROP_PROFILES, getCropProfile } from "./profiles";
import { assessCropSuitability, assessCropTransition } from "./suitability";

function climateFixture(temperatureC = 22, precipitationMm = 20, lastYear = 2022) {
  const months: ClimateMonth[] = [];
  for (let year = 2021; year <= lastYear; year++) {
    for (let month = 1; month <= 12; month++) {
      const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
      months.push({
        month: `${year}-${String(month).padStart(2, "0")}`,
        meanTemperatureC: temperatureC,
        totalPrecipitationMm: precipitationMm,
        expectedDays: days,
        temperatureDays: days,
        precipitationDays: days,
      });
    }
  }
  return { months, provenance: { period: { start: "2021-01-01", end: `${lastYear}-12-31` } } };
}

describe("crop suitability", () => {
  const maize = getCropProfile("maize");

  it("raises maize suitability when irrigation is available and screens out the rainfed water deficit", () => {
    const climate = climateFixture();
    const rainfed = assessCropSuitability(maize, climate, { irrigation: "unavailable" });
    const irrigated = assessCropSuitability(maize, climate, { irrigation: "available" });

    expect(rainfed.score).toBeTypeOf("number");
    expect(irrigated.score).toBeGreaterThan(rainfed.score!);
    expect(rainfed.feasibility).toMatchObject({
      status: "excluded", reasons: [{ code: "WATER_DEFICIT_WITHOUT_IRRIGATION" }],
    });
    expect(irrigated.feasibility).toEqual({ status: "feasible", reasons: [] });
    expect(irrigated.water?.netIrrigationRequirementMm).toBeCloseTo(600);
    expect(irrigated.water).toEqual(rainfed.water);
    expect(irrigated.factors.find(({ code }) => code === "SEASONAL_WATER_BALANCE")?.explanation)
      .toMatch(/if the full modeled supplement can be delivered/);
  });

  it("omits missing pH, reweights the other factors and uses pH when supplied", () => {
    const climate = climateFixture();
    const noMeasurement = assessCropSuitability(maize, climate, { irrigation: "available" });
    const measured = assessCropSuitability(maize, climate, { irrigation: "available", measuredSoilPh: 8.5 });

    expect(noMeasurement.factors.some(({ code }) => code === "MEASURED_SOIL_PH")).toBe(false);
    expect(noMeasurement.warnings).toContainEqual(expect.objectContaining({ code: "SOIL_PH_NOT_PROVIDED" }));
    expect(noMeasurement.factors.reduce((sum, factor) => sum + factor.weight, 0)).toBeCloseTo(1);
    expect(measured.factors).toContainEqual(expect.objectContaining({ code: "MEASURED_SOIL_PH", score: 50 }));
  });

  it("penalizes both same-family transitions and repeated crops", () => {
    const wheat = getCropProfile("wheat");
    const barley = getCropProfile("barley");
    const chickpea = getCropProfile("chickpea");
    const sameFamily = assessCropTransition(barley, wheat);
    const repeated = assessCropTransition(wheat, wheat);
    const diversified = assessCropTransition(chickpea, wheat);

    expect(sameFamily.code).toBe("SAME_FAMILY_REPETITION");
    expect(repeated.score).toBeLessThan(sameFamily.score);
    expect(sameFamily.score).toBeLessThan(diversified.score);
    const climate = climateFixture();
    expect(assessCropSuitability(wheat, climate, { irrigation: "available" }, chickpea).score)
      .toBeGreaterThan(assessCropSuitability(wheat, climate, { irrigation: "available" }, barley).score!);
  });

  it("uses complete winter-cereal water years across New Year", () => {
    const climate = climateFixture();
    for (const month of climate.months) {
      if (month.month < "2021-10" || month.month > "2022-07") month.totalPrecipitationMm = 500;
    }
    const wheat = getCropProfile("wheat");
    const result = assessCropSuitability(wheat, climate, { irrigation: "unavailable" });
    expect(result.water).toMatchObject({ seasons: 1, seasonRainfallMm: 200, storedSoilWaterMm: 130 });
    expect(result.water?.netIrrigationRequirementMm).toBeCloseTo(320);
    const waterFactor = result.factors.find(({ code }) => code === "SEASONAL_WATER_BALANCE");
    expect(waterFactor?.score).toBeCloseTo(100 * (1 - wheat.yieldResponseKy.value * (1 - 330 / 650)));
    expect(waterFactor?.explanation).toContain("1 complete water year(s)");
  });

  it("distinguishes known zero rain from missing rain and refuses to rank the latter", () => {
    const climate = climateFixture(22, 0);
    const result = assessCropSuitability(maize, climate, { irrigation: "unavailable" });

    expect(result.factors).toContainEqual(expect.objectContaining({ code: "SEASONAL_WATER_BALANCE", score: 0 }));
    expect(result.water).toMatchObject({ seasons: 1, rainfedRelativeYield: 0, netIrrigationRequirementMm: 800 });
    expect(result.feasibility.status).toBe("excluded");

    const incomplete = climate.months.find(({ month }) => month === "2022-05")!;
    incomplete.totalPrecipitationMm = null;
    incomplete.precipitationDays = 0;
    const withoutPrecipitation = assessCropSuitability(maize, climate, { irrigation: "unavailable" });
    expect(withoutPrecipitation.score).toBeNull();
    expect(withoutPrecipitation.water).toBeUndefined();
    expect(withoutPrecipitation.feasibility).toMatchObject({
      status: "unscored", reasons: [{ code: "INSUFFICIENT_CLIMATE_EVIDENCE" }],
    });
    expect(withoutPrecipitation.warnings).toContainEqual(expect.objectContaining({ code: "WATER_COVERAGE_INSUFFICIENT" }));
  });

  it("requires active-season temperature evidence while retaining an available water estimate", () => {
    const climate = climateFixture();
    for (const month of climate.months) month.meanTemperatureC = null;
    const outcome = assessCropSuitability(maize, climate, { irrigation: "available" });
    expect(outcome).toMatchObject({
      score: null,
      factors: [],
      water: { seasons: 1 },
      feasibility: { status: "unscored", reasons: [{ code: "INSUFFICIENT_CLIMATE_EVIDENCE" }] },
    });
    expect(outcome.warnings).toContainEqual(expect.objectContaining({ code: "TEMPERATURE_COVERAGE_INSUFFICIENT" }));
  });

  it("retains seasonal water figures but withholds a score when fewer than half the water years are complete", () => {
    const climate = climateFixture(22, 60, 2025);
    for (const month of climate.months) {
      if (month.month >= "2023-01") month.precipitationDays--;
    }

    const outcome = assessCropSuitability(maize, climate, { irrigation: "available" });
    expect(outcome).toMatchObject({ score: null, water: { seasons: 1 }, feasibility: { status: "unscored" } });
    expect(outcome.warnings).toContainEqual(expect.objectContaining({
      code: "WATER_COVERAGE_INSUFFICIENT", message: expect.stringContaining("1 of 4 water years"),
    }));
  });

  it("withholds a score when fewer than half the active temperature seasons are complete", () => {
    const climate = climateFixture(22, 60, 2025);
    for (const month of climate.months) {
      if (month.month >= "2022-01") month.temperatureDays--;
    }

    const outcome = assessCropSuitability(maize, climate, { irrigation: "available" });
    expect(outcome).toMatchObject({ score: null, factors: [], feasibility: { status: "unscored" } });
    expect(outcome.warnings).toContainEqual(expect.objectContaining({
      code: "TEMPERATURE_COVERAGE_INSUFFICIENT", message: expect.stringContaining("1 of 5 active seasons"),
    }));
    expect(assessCropSuitability(maize, climateFixture(22, 60, 2025), { irrigation: "available" }).score).toBeTypeOf("number");
  });

  it("excludes crops outside thermal tolerance even with ample water", () => {
    const outcome = assessCropSuitability(maize, climateFixture(-60, 100), { irrigation: "available" });
    expect(outcome.feasibility).toMatchObject({
      status: "excluded", reasons: [{ code: "TEMPERATURE_OUTSIDE_MODEL_RANGE" }],
    });
  });

  it("keeps locally established rainfed crops eligible on the Konya climate snapshot", () => {
    const eligible = CROP_PROFILES.filter((crop) =>
      assessCropSuitability(crop, snapshot, { irrigation: "unavailable" }).feasibility.status === "feasible"
    );
    expect(eligible.map(({ id }) => id).sort()).toEqual(["barley", "chickpea", "lentil", "wheat"]);
  });

  it("normalizes factor scores and produces totals in range across extreme conditions", () => {
    for (const crop of CROP_PROFILES) {
      for (const [temperature, precipitation, pH] of [[-80, 0, 0], [20, 20, 7], [60, 2000, 14]]) {
        for (const irrigation of ["available", "unavailable"] as const) {
          for (const previous of CROP_PROFILES) {
            const result = assessCropSuitability(crop, climateFixture(temperature, precipitation), {
              irrigation, measuredSoilPh: pH,
            }, previous);
            expect(result.score).toBeTypeOf("number");
            expect(result.score).toBeGreaterThanOrEqual(0);
            expect(result.score).toBeLessThanOrEqual(100);
            for (const { score } of result.factors) {
              expect(score).toBeGreaterThanOrEqual(0);
              expect(score).toBeLessThanOrEqual(100);
            }
            const sum = result.factors.reduce((total, factor) => total + factor.scoreDelta, 50);
            expect(result.score).toBe(Math.round(sum));
          }
        }
      }
    }
  });
});
