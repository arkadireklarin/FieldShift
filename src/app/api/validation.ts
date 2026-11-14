import { CROP_PROFILES } from "../../lib/crops/profiles";
import { MAX_ROOTING_DEPTH_CM, MIN_ROOTING_DEPTH_CM, SOIL_TEXTURE_WATER_MM_PER_M } from "../../lib/crops/water-balance";
import { ClimateUnavailableError, isCoordinates } from "../../lib/nasa";
import type { ApiError, FieldSelection, RotationCycle, RotationSequence, SoilTexture } from "../../types/api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRotationCycle(value: unknown): value is RotationCycle {
  return value === "fallow" || CROP_PROFILES.some(({ id }) => id === value);
}

function isRotationSequence(value: unknown): value is RotationSequence {
  return Array.isArray(value) && value.length === 3 &&
    isRotationCycle(value[0]) && isRotationCycle(value[1]) && isRotationCycle(value[2]);
}

function isHarvestDeadline(value: unknown): value is string {
  return typeof value === "string" && value.length === 7 && /^(19\d{2}|20\d{2}|21\d{2})-(0[1-9]|1[0-2])$/.test(value);
}

function isSoilTexture(value: unknown): value is SoilTexture {
  return typeof value === "string" && value in SOIL_TEXTURE_WATER_MM_PER_M;
}

export function readFieldSelection(input: unknown): FieldSelection | string {
  if (!isRecord(input)) return "Send a JSON object describing the field.";
  const {
    location, previousCrop, irrigation, irrigationQuotaM3PerDa,
    measuredSoilPh, soilTexture, rootingDepthCm, polygon, currentRotation, latestFirstHarvest,
  } = input;
  if (!isCoordinates(location)) {
    return "Provide a numeric location with latitude from -90 to 90 and longitude from -180 to 180.";
  }
  const crop = CROP_PROFILES.find(({ id }) => id === previousCrop);
  if (!crop) return "Choose a previous crop from wheat, barley, chickpea, lentil, sunflower or maize.";
  if (irrigation !== "available" && irrigation !== "unavailable") {
    return 'Set irrigation to "available" or "unavailable".';
  }
  if (irrigationQuotaM3PerDa !== undefined) {
    if (irrigation !== "available") return "An irrigation quota requires irrigation to be available.";
    if (typeof irrigationQuotaM3PerDa !== "number" || !Number.isFinite(irrigationQuotaM3PerDa) ||
      irrigationQuotaM3PerDa < 0 || irrigationQuotaM3PerDa > 10_000) {
      return "Provide the irrigation quota as a number from 0 to 10000 m³ per decare, or omit it.";
    }
  }
  if (measuredSoilPh !== undefined && (
    typeof measuredSoilPh !== "number" || !Number.isFinite(measuredSoilPh) || measuredSoilPh < 0 || measuredSoilPh > 14
  )) {
    return "Provide measured soil pH as a number from 0 to 14, or omit it if unknown.";
  }
  if (soilTexture !== undefined && !isSoilTexture(soilTexture)) {
    return 'Choose soil texture from "coarse", "medium" or "fine", or omit it if unknown.';
  }
  if (rootingDepthCm !== undefined && (
    typeof rootingDepthCm !== "number" || !Number.isFinite(rootingDepthCm) ||
    rootingDepthCm < MIN_ROOTING_DEPTH_CM || rootingDepthCm > MAX_ROOTING_DEPTH_CM
  )) {
    return `Provide effective root-zone depth as a number from ${MIN_ROOTING_DEPTH_CM} to ${MAX_ROOTING_DEPTH_CM} cm, or omit it if unknown.`;
  }
  if (polygon !== undefined && (!Array.isArray(polygon) || !polygon.every(isCoordinates) ||
    new Set(polygon.map(({ lat, lon }) => `${lat},${lon}`)).size < 3)) {
    return "Provide at least three distinct valid coordinates for the field boundary, or omit it.";
  }
  if (currentRotation !== undefined && !isRotationSequence(currentRotation)) {
    return "Provide exactly three cycles with a supported crop or fallow in each, or omit the current rotation.";
  }
  if (latestFirstHarvest !== undefined && !isHarvestDeadline(latestFirstHarvest)) {
    return "Provide the latest first-harvest month in YYYY-MM format with a year from 1900 to 2199, or omit it.";
  }

  return {
    location, previousCrop: crop.id, irrigation, irrigationQuotaM3PerDa,
    measuredSoilPh, soilTexture, rootingDepthCm, polygon, currentRotation, latestFirstHarvest,
  };
}

export function invalidInput(message: string): Response {
  return Response.json({ error: { code: "INVALID_INPUT", message } } satisfies ApiError, { status: 400 });
}

export function climateUnavailable(error: unknown): Response {
  if (!(error instanceof ClimateUnavailableError)) throw error;
  return Response.json({
    error: { code: "CLIMATE_UNAVAILABLE", message: error.message, provenance: error.provenance },
  } satisfies ApiError, { status: 503 });
}
