import type { ApiError, ClimateSummary, FieldSelection, RecommendResponse } from "@/types/api";

export type RequestState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: ApiError["error"] };

export async function requestRecommendation(
  field: FieldSelection,
  signal: AbortSignal,
): Promise<RequestState<RecommendResponse>> {
  try {
    const response = await fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(field),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      cache: "no-store",
    });
    const data: unknown = await response.json().catch(() => null);

    if (response.ok && isRecommendation(data)) {
      return { status: "success", data };
    }
    if (!response.ok && isApiError(data)) {
      return { status: "error", error: data.error };
    }

    return {
      status: "error",
      error: {
        code: "CLIMATE_UNAVAILABLE",
        message: "The service returned an unexpected response. Try analyzing again.",
      },
    };
  } catch {
    return {
      status: "error",
      error: {
        code: "CLIMATE_UNAVAILABLE",
        message: "The request could not be completed. Check your connection and try again.",
      },
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isApiError(value: unknown): value is ApiError {
  if (!isRecord(value) || !isRecord(value.error)) return false;
  const { code, message } = value.error;
  return (code === "NOT_IMPLEMENTED" || code === "INVALID_INPUT" || code === "CLIMATE_UNAVAILABLE") &&
    typeof message === "string";
}

function isClimateSummary(value: unknown): value is ClimateSummary {
  if (!isRecord(value) || !isRecord(value.provenance)) return false;
  return Array.isArray(value.months) && Array.isArray(value.limitations) &&
    (value.provenance.kind === "nasa_power" || value.provenance.kind === "cached_nasa_power") &&
    isRecord(value.provenance.period);
}

function isRecommendation(value: unknown): value is RecommendResponse {
  return isRecord(value) && Array.isArray(value.suitability) && Array.isArray(value.rotations) &&
    Array.isArray(value.provenance) && Array.isArray(value.limitations) && isClimateSummary(value.climate);
}
