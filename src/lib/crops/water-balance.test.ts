import { describe, expect, it } from "vitest";
import type { ClimateMonth } from "../../types/api";
import snapshot from "../../data/validation/konya-nasa-power-2021-2025.json";
import { CROP_PROFILES, getCropProfile } from "./profiles";
import { assessWaterBalance, MIN_RAINFED_RELATIVE_YIELD, relativeYield } from "./water-balance";

function climateFixture(precipitationMm: number, years = [2021, 2022]) {
  const months: ClimateMonth[] = [];
  for (const year of years) {
    for (let month = 1; month <= 12; month++) {
      const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
      months.push({
        month: `${year}-${String(month).padStart(2, "0")}`,
        meanTemperatureC: 20,
        totalPrecipitationMm: precipitationMm,
        expectedDays: days,
        temperatureDays: days,
        precipitationDays: days,
      });
    }
  }
  return { months, provenance: { period: { start: `${years[0]}-01-01`, end: `${years.at(-1)}-12-31` } } };
}

describe("seasonal water balance", () => {
  it("adds capped soil water from the months before planting to in-season rain", () => {
    const chickpea = getCropProfile("chickpea");
    const { balance, expectedSeasons, sufficient } = assessWaterBalance(chickpea, climateFixture(30));

    // March to August 2022 after September 2021 to February 2022. March 2021 has no lead months on record.
    expect(expectedSeasons).toBe(1);
    expect(sufficient).toBe(true);
    expect(balance).toMatchObject({ seasons: 1, seasonRainfallMm: 180, storedSoilWaterMm: 108, fullWaterNeedMm: 560 });
    expect(balance?.rainfedSupplyShare).toBeCloseTo(288 / 560);
    expect(balance?.rainfedRelativeYield).toBeCloseTo(1 - 0.85 * (1 - 288 / 560));
    expect(balance?.netIrrigationRequirementMm).toBeCloseTo(272);

    const wet = assessWaterBalance(chickpea, climateFixture(100)).balance;
    expect(wet).toMatchObject({ storedSoilWaterMm: 130, rainfedSupplyShare: 1, rainfedRelativeYield: 1, netIrrigationRequirementMm: 0 });
  });

  it("follows the FAO-33 response and stays within zero and one", () => {
    expect(relativeYield(1.25, 0.6)).toBeCloseTo(0.5);
    expect(relativeYield(1.25, 0.1)).toBe(0);
    expect(relativeYield(0.85, 1.4)).toBe(1);
  });

  it("drops water years with missing rainfall and never counts a gap as rain", () => {
    const maize = getCropProfile("maize");
    const climate = climateFixture(40, [2021, 2022, 2023, 2024, 2025]);
    const complete = assessWaterBalance(maize, climate);
    expect(complete).toMatchObject({ expectedSeasons: 4, sufficient: true, balance: { seasons: 4 } });

    // A missing month before planting removes that water year.
    const gap = climate.months.find(({ month }) => month === "2022-01")!;
    gap.totalPrecipitationMm = null;
    gap.precipitationDays = 0;
    const partial = assessWaterBalance(maize, climate);
    expect(partial).toMatchObject({ expectedSeasons: 4, sufficient: true, balance: { seasons: 3 } });
    expect(partial.balance?.rainfedSupplyShare).toBeCloseTo(complete.balance!.rainfedSupplyShare);

    for (const month of climate.months) {
      if (month.month >= "2023-01") month.precipitationDays = month.expectedDays - 1;
    }
    expect(assessWaterBalance(maize, climate)).toEqual({ expectedSeasons: 4, sufficient: false });
  });

  it("reproduces which crops are grown without irrigation around Konya", () => {
    const rainfed = CROP_PROFILES
      .filter((crop) => assessWaterBalance(crop, snapshot).balance!.rainfedRelativeYield >= MIN_RAINFED_RELATIVE_YIELD)
      .map(({ id }) => id);

    expect(rainfed.sort()).toEqual(["barley", "chickpea", "lentil", "wheat"]);
    for (const crop of CROP_PROFILES) {
      expect(assessWaterBalance(crop, snapshot)).toMatchObject({ sufficient: true, balance: { seasons: 4, soilStorageCapMm: 130 } });
    }
  });

  it("scales preseason soil water storage by FAO-56 texture class and crop-bounded root depth", () => {
    const chickpea = getCropProfile("chickpea");
    const lentil = getCropProfile("lentil");
    const wheat = getCropProfile("wheat");
    const wetPreseason = climateFixture(40); // 6 lead months * 40 mm = 240 mm -> 0.6 * 240 = 144 mm recharge

    const defaultRun = assessWaterBalance(chickpea, wetPreseason).balance!;
    expect(defaultRun.soilStorageCapMm).toBe(130);
    expect(defaultRun.storedSoilWaterMm).toBe(130);

    // Shallow 50 cm caliche layer caps all crops at 0.50 m * 130 mm/m = 65 mm
    const shallow = assessWaterBalance(chickpea, wetPreseason, { rootingDepthCm: 50 }).balance!;
    expect(shallow.soilStorageCapMm).toBe(65);
    expect(shallow.effectiveRootDepthM).toBe(0.5);
    expect(shallow.storedSoilWaterMm).toBe(65);
    expect(shallow.netIrrigationRequirementMm).toBeGreaterThan(defaultRun.netIrrigationRequirementMm);

    // Coarse texture (90 mm/m) caps lentil (0.8 m max root) at 72 mm and chickpea (1.0 m max root) at 90 mm
    const coarseLentil = assessWaterBalance(lentil, wetPreseason, { soilTexture: "coarse" }).balance!;
    const coarseChickpea = assessWaterBalance(chickpea, wetPreseason, { soilTexture: "coarse" }).balance!;
    expect(coarseLentil.soilStorageCapMm).toBe(72);
    expect(coarseLentil.effectiveRootDepthM).toBe(0.8);
    expect(coarseChickpea.soilStorageCapMm).toBe(90);
    expect(coarseChickpea.effectiveRootDepthM).toBe(1);

    // Deep fine soil (170 mm/m, 150 cm) allows wheat (1.8 m max root) to use 1.5 m (255 mm cap), while lentil stops at 0.8 m (136 mm cap)
    const deepFineWheat = assessWaterBalance(wheat, wetPreseason, { soilTexture: "fine", rootingDepthCm: 150 }).balance!;
    const deepFineLentil = assessWaterBalance(lentil, wetPreseason, { soilTexture: "fine", rootingDepthCm: 150 }).balance!;
    expect(deepFineWheat.soilStorageCapMm).toBe(255);
    expect(deepFineWheat.effectiveRootDepthM).toBe(1.5);
    expect(deepFineLentil.soilStorageCapMm).toBe(136);
    expect(deepFineLentil.effectiveRootDepthM).toBe(0.8);
  });
});
