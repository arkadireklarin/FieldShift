import type { ClimateSummary, CropWaterBalance } from "../../types/api";
import type { AgronomicCropProfile } from "./profiles";

/**
 * Share of the precipitation before planting that is still in the root zone at planting, and the most
 * stored soil water a crop draws in a season. Non-irrigated chickpea and sunflower plots in two Konya
 * trials drew about 128 mm from the soil, 55–67% of long-term precipitation in the months before planting.
 */
export const SOIL_RECHARGE_EFFICIENCY = 0.6;
export const MAX_STORED_SOIL_WATER_MM = 130;

/**
 * Rainfed crops expected to yield less than this share of their water-unlimited yield stay out of plans.
 * The cutoff separates the crops grown without irrigation around Konya from those grown with it.
 */
export const MIN_RAINFED_RELATIVE_YIELD = 0.4;

type WaterClimate = Pick<ClimateSummary, "months"> & {
  provenance: Pick<ClimateSummary["provenance"], "period">;
};

export interface WaterAssessment {
  /** Undefined when no water year is complete. */
  balance?: CropWaterBalance;
  /** Water years that fit inside the climate record. */
  expectedSeasons: number;
  /** True when at least half of the expected water years have complete rainfall. */
  sufficient: boolean;
}

function monthIndex(date: string): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

/** FAO-33 seasonal yield response to a relative shortfall in water use. */
export function relativeYield(ky: number, supplyShare: number): number {
  return Math.min(1, Math.max(0, 1 - ky * (1 - Math.min(1, Math.max(0, supplyShare)))));
}

/**
 * Compare rainfall and stored soil water with the crop's water use without stress. A water year is
 * the growing season plus the months since the previous season ended, and counts only when all
 * twelve months have complete rainfall.
 */
export function assessWaterBalance(crop: AgronomicCropProfile, climate: WaterClimate): WaterAssessment {
  const { growingStartMonth, growingEndMonth } = crop.calendar;
  const fullWaterNeedMm = crop.waterRequirementMm.max;
  const seasonLength = (growingEndMonth - growingStartMonth + 12) % 12 + 1;
  const leadMonths = 12 - seasonLength;
  const firstMonth = monthIndex(climate.provenance.period.start);
  const lastMonth = monthIndex(climate.provenance.period.end);
  const rainfall = new Map<number, number>();
  for (const { month, totalPrecipitationMm, precipitationDays, expectedDays } of climate.months) {
    if (totalPrecipitationMm !== null && Number.isFinite(totalPrecipitationMm) &&
        expectedDays > 0 && precipitationDays === expectedDays) {
      rainfall.set(monthIndex(month), totalPrecipitationMm);
    }
  }

  const totals = { rain: 0, stored: 0, share: 0, yield: 0, irrigation: 0 };
  let seasons = 0;
  let expectedSeasons = 0;
  for (let planting = firstMonth + leadMonths; planting + seasonLength - 1 <= lastMonth; planting++) {
    if (planting % 12 !== growingStartMonth - 1) continue;
    expectedSeasons++;

    let before = 0;
    let during = 0;
    let complete = true;
    for (let month = planting - leadMonths; month < planting + seasonLength; month++) {
      const value = rainfall.get(month);
      if (value === undefined) {
        complete = false;
        break;
      }
      if (month < planting) before += value;
      else during += value;
    }
    if (!complete) continue;

    const stored = Math.min(MAX_STORED_SOIL_WATER_MM, SOIL_RECHARGE_EFFICIENCY * before);
    const supply = Math.min(fullWaterNeedMm, during + stored);
    const share = supply / fullWaterNeedMm;
    seasons++;
    totals.rain += during;
    totals.stored += stored;
    totals.share += share;
    totals.yield += relativeYield(crop.yieldResponseKy.value, share);
    totals.irrigation += fullWaterNeedMm - supply;
  }

  const sufficient = seasons > 0 && seasons >= Math.ceil(expectedSeasons / 2);
  if (seasons === 0) return { expectedSeasons, sufficient };
  return {
    expectedSeasons,
    sufficient,
    balance: {
      seasons,
      seasonRainfallMm: totals.rain / seasons,
      storedSoilWaterMm: totals.stored / seasons,
      fullWaterNeedMm,
      rainfedSupplyShare: totals.share / seasons,
      rainfedRelativeYield: totals.yield / seasons,
      netIrrigationRequirementMm: totals.irrigation / seasons,
    },
  };
}
