import type { ClimateSummary, CropFeasibility, CropSuitability, FieldSelection } from "../../types/api";
import type { AgronomicCropProfile } from "./profiles";
import { assessWaterBalance, MIN_RAINFED_RELATIVE_YIELD } from "./water-balance";

type FactorCode =
  | "ACTIVE_SEASON_TEMPERATURE"
  | "SEASONAL_WATER_BALANCE"
  | "MEASURED_SOIL_PH"
  | "SAME_CROP_REPETITION"
  | "SAME_FAMILY_REPETITION"
  | "LEGUME_TO_CEREAL"
  | "CEREAL_TO_LEGUME"
  | "BOTANICAL_FAMILY_CHANGE";

type WarningCode =
  | "TEMPERATURE_COVERAGE_INSUFFICIENT"
  | "TEMPERATURE_SEASONS_EXCLUDED"
  | "TEMPERATURE_OUTSIDE_MODEL_RANGE"
  | "WATER_COVERAGE_INSUFFICIENT"
  | "WATER_SEASONS_EXCLUDED"
  | "SOIL_PH_NOT_PROVIDED"
  | "PROFILE_SOIL_PH_UNAVAILABLE"
  | "WATER_DEFICIT_WITHOUT_IRRIGATION"
  | "INSUFFICIENT_CLIMATE_EVIDENCE";

export interface SuitabilityFactor {
  code: FactorCode;
  label: string;
  /** Normalized factor score from 0 to 100. */
  score: number;
  explanation: string;
}

export interface SuitabilityResult extends CropSuitability {
  feasibility: CropFeasibility;
  factors: ReadonlyArray<SuitabilityFactor & {
    /** Effective share of the total after omitted factors are excluded. */
    weight: number;
    /** Signed contribution relative to a neutral base score of 50. */
    scoreDelta: number;
  }>;
  warnings: ReadonlyArray<{ code: WarningCode; message: string }>;
}

const WEIGHTS = { temperature: 35, water: 45, soilPh: 10, previousCrop: 10 };
// Retain sensitivity to inherent water stress while crediting irrigation capacity separately.
const IRRIGATED_RAINFED_WEIGHT = 25 / WEIGHTS.water;

const LIMITATIONS = [
  "Crop response ranges, planting calendars and factor weights are provisional heuristics.",
  "Monthly mean air temperatures can mask heat, frost and other short-lived stress.",
  "The seasonal water balance treats in-season rain as available and estimates preseason soil storage. Actual effective rainfall, field storage, crop water use and irrigation efficiency are unknown.",
  "Rainfed yield share is a screening indicator relative to water-unlimited yield. Other yield constraints and short-lived water stress are outside the water model.",
];

type MonthSample = { value: number; days: number };
type SuitabilityClimate = Pick<ClimateSummary, "months"> & {
  provenance: Pick<ClimateSummary["provenance"], "period">;
};

function monthIndex(date: string): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

function completeTemperatureSeasons(
  climate: SuitabilityClimate,
  startMonth: number,
  endMonth: number,
) {
  const firstMonth = monthIndex(climate.provenance.period.start);
  const lastMonth = monthIndex(climate.provenance.period.end);
  const length = (endMonth - startMonth + 12) % 12 + 1;
  const months = new Map(climate.months.map((month) => [monthIndex(month.month), month]));
  const seasons: MonthSample[][] = [];
  let expected = 0;

  for (let start = firstMonth; start + length - 1 <= lastMonth; start++) {
    if (start % 12 !== startMonth - 1) continue;
    expected++;

    const samples: MonthSample[] = [];
    for (let offset = 0; offset < length; offset++) {
      const month = months.get(start + offset);
      if (!month) break;
      const { meanTemperatureC: value, temperatureDays: days } = month;
      if (value === null || !Number.isFinite(value) || days <= 0 || days !== month.expectedDays) break;
      samples.push({ value, days });
    }
    if (samples.length === length) seasons.push(samples);
  }

  return { seasons, expected };
}

function bandScore(value: number, range: { min: number; max: number }, falloff: number): number {
  const distance = Math.max(0, range.min - value, value - range.max);
  return 100 * Math.max(0, 1 - distance / falloff);
}

export function assessCropTransition(
  previousCrop: AgronomicCropProfile,
  crop: AgronomicCropProfile,
): SuitabilityFactor {
  const label = "Previous crop compatibility";
  if (previousCrop.id === crop.id) {
    return {
      code: "SAME_CROP_REPETITION", label, score: 5,
      explanation: `Repeating ${crop.name} can carry crop-specific pests and diseases into the next cycle.`,
    };
  }
  if (previousCrop.family === crop.family) {
    return {
      code: "SAME_FAMILY_REPETITION", label, score: 25,
      explanation: `${previousCrop.name} and ${crop.name} share the ${crop.family} family and may share pests or diseases.`,
    };
  }
  if (previousCrop.category === "legume" && crop.category === "cereal") {
    return {
      code: "LEGUME_TO_CEREAL", label, score: 100,
      explanation: `${previousCrop.name} may leave residual nitrogen for ${crop.name}. The amount depends on fixation, residue removal and soil conditions.`,
    };
  }
  if (previousCrop.category === "cereal" && crop.category === "legume") {
    return {
      code: "CEREAL_TO_LEGUME", label, score: 85,
      explanation: `${crop.name} can interrupt some cereal-specific pest and disease cycles after ${previousCrop.name}.`,
    };
  }
  return {
    code: "BOTANICAL_FAMILY_CHANGE", label, score: 70,
    explanation: `${previousCrop.name} and ${crop.name} belong to different botanical families, which can help interrupt some crop-specific pest and disease cycles.`,
  };
}

export function assessCropSuitability(
  crop: AgronomicCropProfile,
  climate: SuitabilityClimate,
  field: Pick<FieldSelection, "irrigation" | "measuredSoilPh">,
  previousCrop?: AgronomicCropProfile,
): SuitabilityResult {
  const { calendar, temperatureC, soilPh } = crop;
  const weightedFactors: { factor: SuitabilityFactor; weight: number }[] = [];
  const warnings: { code: WarningCode; message: string }[] = [];
  const exclusions: Array<CropFeasibility["reasons"][number]> = [];
  const temperature = completeTemperatureSeasons(climate, calendar.activeStartMonth, calendar.activeEndMonth);
  const water = assessWaterBalance(crop, climate);
  // A gap can hide a poor season, so each climate metric needs at least half of its expected seasons.
  const temperatureSufficient = temperature.seasons.length > 0 &&
    temperature.seasons.length >= Math.ceil(temperature.expected / 2);

  if (!temperatureSufficient) {
    warnings.push({
      code: "TEMPERATURE_COVERAGE_INSUFFICIENT",
      message: temperature.seasons.length === 0
        ? "No active growing season has complete temperature observations."
        : `Temperature coverage is complete for ${temperature.seasons.length} of ${temperature.expected} active seasons. At least half must be complete.`,
    });
  } else {
    const samples = temperature.seasons.flat();
    const totalDays = samples.reduce((total, sample) => total + sample.days, 0);
    const mean = samples.reduce((total, sample) => total + sample.value * sample.days, 0) / totalDays;
    const score = samples.reduce((total, sample) => total + bandScore(sample.value, temperatureC, 12) * sample.days, 0) / totalDays;
    weightedFactors.push({ weight: WEIGHTS.temperature, factor: {
      code: "ACTIVE_SEASON_TEMPERATURE",
      label: "Active-season temperature",
      score,
      explanation: `Mean temperature was ${mean.toFixed(1)} °C across ${temperature.seasons.length} complete active season(s). Each monthly mean is scored against the ${temperatureC.min}–${temperatureC.max} °C band and weighted by observed days. Fit declines linearly to zero at 12 °C outside the band.`,
    } });
    if (score === 0) {
      const reason = {
        code: "TEMPERATURE_OUTSIDE_MODEL_RANGE",
        message: "Every scored active-season month was beyond the crop's modeled temperature tolerance.",
      } as const;
      exclusions.push(reason);
      warnings.push(reason);
    }
    if (temperature.seasons.length < temperature.expected) {
      warnings.push({
        code: "TEMPERATURE_SEASONS_EXCLUDED",
        message: `Temperature coverage was incomplete for ${temperature.expected - temperature.seasons.length} active season(s). Those seasons were excluded.`,
      });
    }
  }

  if (!water.sufficient) {
    warnings.push({
      code: "WATER_COVERAGE_INSUFFICIENT",
      message: water.expectedSeasons === 0
        ? "The climate record is too short to cover a full water year for this crop."
        : `Rainfall coverage is complete for ${water.balance?.seasons ?? 0} of ${water.expectedSeasons} water years. At least half must be complete.`,
    });
  }

  const irrigated = field.irrigation === "available";
  if (water.sufficient && water.balance) {
    const { rainfedRelativeYield, netIrrigationRequirementMm, seasons } = water.balance;
    const rainfedPercentage = 100 * rainfedRelativeYield;
    const score = irrigated
      ? rainfedPercentage * IRRIGATED_RAINFED_WEIGHT + 100 * (1 - IRRIGATED_RAINFED_WEIGHT)
      : rainfedPercentage;
    const explanation = `Across ${seasons} complete water year(s), the model estimates rainfed yield at ${rainfedPercentage.toFixed(1)}% of water-unlimited yield. Net irrigation to meet full demand averages ${netIrrigationRequirementMm.toFixed(1)} mm per season.`;
    weightedFactors.push({ weight: WEIGHTS.water, factor: {
      code: "SEASONAL_WATER_BALANCE",
      label: "Seasonal water balance",
      score,
      explanation: irrigated
        ? `${explanation} The score credits potential irrigation only if the full modeled supplement can be delivered.`
        : explanation,
    } });
    if (seasons < water.expectedSeasons) {
      warnings.push({
        code: "WATER_SEASONS_EXCLUDED",
        message: `Rainfall coverage was incomplete for ${water.expectedSeasons - seasons} water year(s). Those years were excluded.`,
      });
    }
    if (!irrigated && rainfedRelativeYield < MIN_RAINFED_RELATIVE_YIELD) {
      const reason = {
        code: "WATER_DEFICIT_WITHOUT_IRRIGATION",
        message: `Modeled rainfed yield share is ${rainfedPercentage.toFixed(1)}%, below the provisional ${100 * MIN_RAINFED_RELATIVE_YIELD}% screening threshold.`,
      } as const;
      exclusions.push(reason);
      warnings.push(reason);
    }
  }

  const measuredPh = field.measuredSoilPh;
  if (measuredPh === undefined || !Number.isFinite(measuredPh) || measuredPh < 0 || measuredPh > 14) {
    warnings.push({ code: "SOIL_PH_NOT_PROVIDED", message: "Soil pH was omitted because no valid measurement was supplied." });
  } else if (soilPh === null) {
    warnings.push({ code: "PROFILE_SOIL_PH_UNAVAILABLE", message: `Soil pH was omitted because ${crop.name} lacks a profile range suitable for scoring.` });
  } else {
    weightedFactors.push({ weight: WEIGHTS.soilPh, factor: {
      code: "MEASURED_SOIL_PH",
      label: "Measured soil pH",
      score: bandScore(measuredPh, soilPh, 2),
      explanation: `Measured pH ${measuredPh} was compared with the provisional range ${soilPh.min}–${soilPh.max}. This factor tapers to zero at two pH units outside the band.`,
    } });
  }

  if (previousCrop) {
    weightedFactors.push({ weight: WEIGHTS.previousCrop, factor: assessCropTransition(previousCrop, crop) });
  }

  const hasClimateEvidence = temperatureSufficient && water.sufficient;
  let feasibility: CropFeasibility;
  if (hasClimateEvidence) {
    feasibility = { status: exclusions.length ? "excluded" : "feasible", reasons: exclusions };
  } else {
    const reason = {
      code: "INSUFFICIENT_CLIMATE_EVIDENCE",
      message: "Scoring requires complete temperature and rainfall for at least half of the seasons on record.",
    } as const;
    warnings.push(reason);
    feasibility = { status: "unscored", reasons: [reason, ...exclusions] };
  }

  const weightTotal = weightedFactors.reduce((total, entry) => total + entry.weight, 0);
  const factors = hasClimateEvidence ? weightedFactors.map(({ factor, weight }) => ({
    ...factor,
    weight: weight / weightTotal,
    scoreDelta: (factor.score - 50) * weight / weightTotal,
  })) : [];

  return {
    crop: crop.id,
    score: hasClimateEvidence ? Math.round(50 + factors.reduce((total, factor) => total + factor.scoreDelta, 0)) : null,
    feasibility,
    water: water.balance,
    factors,
    warnings,
    limitations: [...LIMITATIONS, ...crop.limitations, ...warnings.map((warning) => warning.message)],
  };
}
