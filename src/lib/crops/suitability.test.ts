import { describe, expect, it } from "vitest";
import type { ClimateMonth } from "../../types/api";
import { CROP_PROFILES, getCropProfile } from "./profiles";
import { assessCropSuitability, assessCropTransition } from "./suitability";

function climateFixture(temperatureC = 22, precipitationMm = 20) {
  const months: ClimateMonth[] = [];
  for (const year of [2021, 2022]) {
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
  return { months, provenance: { period: { start: "2021-01-01", end: "2022-12-31" } } };
}

describe("crop suitability", () => {
  const maize = getCropProfile("maize");

  it("raises maize suitability when irrigation is available", () => {
    const climate = climateFixture();
    const rainfed = assessCropSuitability(maize, climate, { irrigation: "unavailable" });
    const irrigated = assessCropSuitability(maize, climate, { irrigation: "available" });

    expect(rainfed.score).toBeTypeOf("number");
    expect(irrigated.score).toBeGreaterThan(rainfed.score!);
    expect(rainfed.warnings).toContainEqual(expect.objectContaining({ code: "LOW_RAINFED_WATER_COVERAGE" }));
    expect(irrigated.factors.find(({ code }) => code === "IRRIGATION_AVAILABLE")?.score).toBe(100);
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

  it("uses complete winter-cereal water seasons across calendar years", () => {
    const climate = climateFixture();
    for (const month of climate.months) {
      if (month.month < "2021-10" || month.month > "2022-07") month.totalPrecipitationMm = 500;
    }
    const wheat = getCropProfile("wheat");
    const result = assessCropSuitability(wheat, climate, { irrigation: "unavailable" });
    const precipitationFactor = result.factors.find(({ code }) => code === "GROWING_SEASON_PRECIPITATION");

    expect(precipitationFactor?.score).toBeCloseTo(100 * 200 / wheat.waterRequirementMm.min);
    expect(precipitationFactor?.explanation).toContain("1 complete growing season");
  });

  it("excludes incomplete seasons and distinguishes measured zero rain from missing rain", () => {
    const climate = climateFixture(22, 0);
    const incomplete = climate.months.find(({ month }) => month === "2021-05")!;
    incomplete.totalPrecipitationMm = null;
    incomplete.precipitationDays = 0;
    const result = assessCropSuitability(maize, climate, { irrigation: "unavailable" });

    expect(result.factors).toContainEqual(expect.objectContaining({ code: "GROWING_SEASON_PRECIPITATION", score: 0 }));
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "PRECIPITATION_SEASONS_EXCLUDED" }));

    for (const month of climate.months) month.totalPrecipitationMm = null;
    const withoutPrecipitation = assessCropSuitability(maize, climate, { irrigation: "unavailable" });
    expect(withoutPrecipitation.score).toBeGreaterThan(result.score!);
    expect(withoutPrecipitation.factors.some(({ code }) => code === "GROWING_SEASON_PRECIPITATION")).toBe(false);

    for (const month of climate.months) month.meanTemperatureC = null;
    const withoutClimate = assessCropSuitability(maize, climate, { irrigation: "unavailable" });
    expect(withoutClimate.score).toBeNull();
    expect(withoutClimate.warnings).toContainEqual(expect.objectContaining({ code: "INSUFFICIENT_CLIMATE_EVIDENCE" }));
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
