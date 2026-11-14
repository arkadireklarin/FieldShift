import type { ClimateSummary, CropSuitability, FieldSelection } from "../../types/api";
import type { AgronomicCropProfile } from "./profiles";

type FactorCode =
  | "ACTIVE_SEASON_TEMPERATURE"
  | "GROWING_SEASON_PRECIPITATION"
  | "IRRIGATION_AVAILABLE"
  | "RAINFED"
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
  | "PRECIPITATION_COVERAGE_INSUFFICIENT"
  | "PRECIPITATION_SEASONS_EXCLUDED"
  | "SOIL_PH_NOT_PROVIDED"
  | "PROFILE_SOIL_PH_UNAVAILABLE"
  | "LOW_RAINFED_WATER_COVERAGE"
  | "INSUFFICIENT_CLIMATE_EVIDENCE";

export interface SuitabilityFactor {
  code: FactorCode;
  label: string;
  /** Normalized factor score from 0 to 100. */
  score: number;
  explanation: string;
}

export interface SuitabilityResult extends CropSuitability {
  factors: ReadonlyArray<SuitabilityFactor & {
    /** Effective share of the total after omitted factors are excluded. */
    weight: number;
    /** Signed contribution relative to a neutral base score of 50. */
    scoreDelta: number;
  }>;
  warnings: ReadonlyArray<{ code: WarningCode; message: string }>;
}

const WEIGHTS = { temperature: 35, precipitation: 25, irrigation: 20, soilPh: 10, previousCrop: 10 };

const IRRIGATION_SCORES = {
  low: { available: 85, unavailable: 75 },
  medium: { available: 90, unavailable: 55 },
  high: { available: 100, unavailable: 20 },
} as const;

const LIMITATIONS = [
  "Crop response ranges, planting calendars and factor weights are provisional heuristics.",
  "Monthly mean air temperatures can mask heat, frost and other short-lived stress.",
  "Seasonal rainfall is compared with approximate crop water demand as a proxy. Effective rainfall, soil water storage and irrigation amounts are unknown.",
];

type MonthSample = { value: number; days: number };
type SuitabilityClimate = Pick<ClimateSummary, "months"> & {
  provenance: Pick<ClimateSummary["provenance"], "period">;
};

function monthIndex(date: string): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

function completeSeasons(
  climate: SuitabilityClimate,
  startMonth: number,
  endMonth: number,
  metric: "temperature" | "precipitation",
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
      const value = metric === "temperature" ? month.meanTemperatureC : month.totalPrecipitationMm;
      const days = metric === "temperature" ? month.temperatureDays : month.precipitationDays;
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
  const { calendar, temperatureC, waterRequirementMm, soilPh, irrigationSensitivity } = crop;
  const weightedFactors: { factor: SuitabilityFactor; weight: number }[] = [];
  const warnings: { code: WarningCode; message: string }[] = [];
  const temperature = completeSeasons(climate, calendar.activeStartMonth, calendar.activeEndMonth, "temperature");
  const precipitation = completeSeasons(climate, calendar.growingStartMonth, calendar.growingEndMonth, "precipitation");

  if (temperature.seasons.length === 0) {
    warnings.push({
      code: "TEMPERATURE_COVERAGE_INSUFFICIENT",
      message: "Temperature was omitted because no active growing season has complete observations.",
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
      warnings.push({
        code: "TEMPERATURE_OUTSIDE_MODEL_RANGE",
        message: "Every scored active-season month was outside this crop's modeled temperature range. This crop is excluded from rotation plans.",
      });
    }
    if (temperature.seasons.length < temperature.expected) {
      warnings.push({
        code: "TEMPERATURE_SEASONS_EXCLUDED",
        message: `Temperature coverage was incomplete for ${temperature.expected - temperature.seasons.length} active season(s). Those seasons were excluded.`,
      });
    }
  }

  if (precipitation.seasons.length === 0) {
    warnings.push({
      code: "PRECIPITATION_COVERAGE_INSUFFICIENT",
      message: "Precipitation was omitted because no growing season has complete observations.",
    });
  } else {
    const totals = precipitation.seasons.map((season) => season.reduce((sum, sample) => sum + sample.value, 0));
    const mean = totals.reduce((sum, total) => sum + total, 0) / totals.length;
    const score = totals.reduce((sum, total) => sum + 100 * Math.min(1, Math.max(0, total / waterRequirementMm.min)), 0) / totals.length;
    weightedFactors.push({ weight: WEIGHTS.precipitation, factor: {
      code: "GROWING_SEASON_PRECIPITATION",
      label: "Growing-season precipitation",
      score,
      explanation: `NASA POWER rainfall averaged ${mean.toFixed(1)} mm across ${totals.length} complete growing season(s). This factor averages each season's share of the lower crop water requirement (${waterRequirementMm.min} mm of a provisional ${waterRequirementMm.min}–${waterRequirementMm.max} mm range), capped at 100%.`,
    } });
    if (precipitation.seasons.length < precipitation.expected) {
      warnings.push({
        code: "PRECIPITATION_SEASONS_EXCLUDED",
        message: `Rainfall coverage was incomplete for ${precipitation.expected - precipitation.seasons.length} growing season(s). Those seasons were excluded.`,
      });
    }
    if (score < 50 && field.irrigation === "unavailable") {
      warnings.push({
        code: "LOW_RAINFED_WATER_COVERAGE",
        message: "Historical rainfall alone covered less than half of the lower crop water requirement on the model's seasonal coverage scale.",
      });
    }
  }

  const irrigated = field.irrigation === "available";
  weightedFactors.push({ weight: WEIGHTS.irrigation, factor: {
    code: irrigated ? "IRRIGATION_AVAILABLE" : "RAINFED",
    label: "Irrigation availability",
    score: IRRIGATION_SCORES[irrigationSensitivity][field.irrigation],
    explanation: irrigated
      ? `Irrigation is available. ${crop.name} has a provisional ${irrigationSensitivity} sensitivity to water stress. The amount of water available is unknown.`
      : `The field is rainfed. ${crop.name} has a provisional ${irrigationSensitivity} sensitivity to water stress.`,
  } });

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

  const hasClimateEvidence = temperature.seasons.length > 0 || precipitation.seasons.length > 0;
  if (!hasClimateEvidence) {
    warnings.push({ code: "INSUFFICIENT_CLIMATE_EVIDENCE", message: "At least one complete seasonal climate metric is required to score this crop." });
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
    factors,
    warnings,
    limitations: [...LIMITATIONS, ...crop.limitations, ...warnings.map((warning) => warning.message)],
  };
}
