import { CROP_PROFILES } from "../../lib/crops/profiles";
import { ClimateUnavailableError, isCoordinates } from "../../lib/nasa";
import type { ApiError, FieldSelection } from "../../types/api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readFieldSelection(input: unknown): FieldSelection | string {
  if (!isRecord(input)) return "Send a JSON object describing the field.";
  const { location, previousCrop, irrigation, measuredSoilPh, polygon } = input;
  if (!isCoordinates(location)) {
    return "Provide a numeric location with latitude from -90 to 90 and longitude from -180 to 180.";
  }
  const crop = CROP_PROFILES.find(({ id }) => id === previousCrop);
  if (!crop) return "Choose a previous crop from wheat, barley, chickpea, lentil, sunflower or maize.";
  if (irrigation !== "available" && irrigation !== "unavailable") {
    return 'Set irrigation to "available" or "unavailable".';
  }
  if (measuredSoilPh !== undefined && (
    typeof measuredSoilPh !== "number" || !Number.isFinite(measuredSoilPh) || measuredSoilPh < 0 || measuredSoilPh > 14
  )) {
    return "Provide measured soil pH as a number from 0 to 14, or omit it if unknown.";
  }
  if (polygon !== undefined && (!Array.isArray(polygon) || !polygon.every(isCoordinates) ||
    new Set(polygon.map(({ lat, lon }) => `${lat},${lon}`)).size < 3)) {
    return "Provide at least three distinct valid coordinates for the field boundary, or omit it.";
  }

  return { location, previousCrop: crop.id, irrigation, measuredSoilPh, polygon };
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
