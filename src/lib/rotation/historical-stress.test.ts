import { describe, expect, it } from "vitest";
import type { ClimateSummary } from "../../types/api";
import { buildHistoricalStress } from "./historical-stress";

function climateFixture(monthlyRainfall: number[]): ClimateSummary {
  const firstYear = 2021;
  const lastYear = firstYear + monthlyRainfall.length - 1;
  const months = monthlyRainfall.flatMap((totalPrecipitationMm, index) => {
    const year = firstYear + index;
    return Array.from({ length: 12 }, (_, month) => {
      const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      return {
        month: `${year}-${String(month + 1).padStart(2, "0")}`,
        meanTemperatureC: index + month,
        totalPrecipitationMm,
        expectedDays: days,
        temperatureDays: days,
        precipitationDays: days,
      };
    });
  });
  return {
    months,
    provenance: {
      kind: "nasa_power",
      source: "NASA POWER",
      sourceUrl: "https://example.com/climate-fixture",
      requestedLocation: { lat: 37.57, lon: 32.77 },
      retrievedAt: "2026-01-01T00:00:00Z",
      period: { start: `${firstYear}-01-01`, end: `${lastYear}-12-31` },
      spatialScope: "grid_cell",
      parameters: ["T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR"],
    },
    limitations: [],
  };
}

describe("historical stress replay", () => {
  it("repeats both series from the same driest year with each target month's day counts", () => {
    const climate = climateFixture([20, 15, 0, 30]);
    const dryMarch = climate.months.find(({ month }) => month === "2023-03")!;
    dryMarch.totalPrecipitationMm = 7;
    const result = buildHistoricalStress(climate)!;

    expect(result).toMatchObject({ year: 2023, precipitationMm: 7, medianPrecipitationMm: 210, completeYears: 4 });
    expect(result.climate.months).toHaveLength(48);
    expect(result.climate.months.find(({ month }) => month === "2024-02")).toMatchObject({
      meanTemperatureC: 3,
      totalPrecipitationMm: 0,
      expectedDays: 29,
      temperatureDays: 29,
      precipitationDays: 29,
    });
    expect(result.climate.months.find(({ month }) => month === "2021-03")).toMatchObject({
      meanTemperatureC: dryMarch.meanTemperatureC,
      totalPrecipitationMm: dryMarch.totalPrecipitationMm,
    });
    expect(climate.months.find(({ month }) => month === "2021-03")?.totalPrecipitationMm).toBe(20);
  });

  it("excludes years with a missing month, incomplete coverage or unknown observations", () => {
    const climate = climateFixture([0, 0, 0, 5, 10]);
    climate.months = climate.months.filter(({ month }) => month !== "2021-01");
    climate.months.find(({ month }) => month === "2022-04")!.precipitationDays--;
    climate.months.find(({ month }) => month === "2023-10")!.meanTemperatureC = null;

    expect(buildHistoricalStress(climate)).toMatchObject({
      year: 2024, precipitationMm: 60, medianPrecipitationMm: 90, completeYears: 2,
    });
    climate.months.find(({ month }) => month === "2025-06")!.temperatureDays--;
    expect(buildHistoricalStress(climate)).toBeUndefined();
  });

  it("resolves tied driest years by date when their total is below the median", () => {
    const climate = climateFixture([4, 4, 8, 12]);
    const result = buildHistoricalStress({ ...climate, months: [...climate.months].reverse() });

    expect(result).toMatchObject({ year: 2021, precipitationMm: 48, medianPrecipitationMm: 72, completeYears: 4 });
    expect(buildHistoricalStress(climateFixture([4, 4, 8]))).toBeUndefined();
  });
});
