import type { Coordinates, DataProvenance } from "../../types/api";
import { aggregateClimate, InvalidNasaResponse, PARAMETERS, PERIOD, type ClimateData } from "./aggregate";

export type { ClimateData, ClimateYear } from "./aggregate";

const ENDPOINT = "https://power.larc.nasa.gov/api/temporal/daily/point";
const FRESH_FOR_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 60_000;
const MAX_CACHE_ENTRIES = 128;

type UnavailableProvenance = Extract<DataProvenance, { kind: "unavailable" }>;
type Source = Omit<UnavailableProvenance, "kind" | "reason">;
type NasaClimateData = ClimateData & { provenance: Extract<DataProvenance, { kind: "nasa_power" }> };

export class ClimateUnavailableError extends Error {
  readonly provenance: UnavailableProvenance;

  constructor(message: string, source: Source) {
    super(message);
    this.name = "ClimateUnavailableError";
    this.provenance = { ...source, kind: "unavailable", reason: message };
  }
}

export function isCoordinates(value: unknown): value is Coordinates {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { lat, lon } = value as Partial<Coordinates>;
  return typeof lat === "number" && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
    typeof lon === "number" && Number.isFinite(lon) && Math.abs(lon) <= 180;
}

function sourceFor({ lat, lon }: Coordinates): Source {
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    parameters: PARAMETERS.join(","),
    community: "AG",
    latitude: String(lat),
    longitude: String(lon),
    start: PERIOD.start.replaceAll("-", ""),
    end: PERIOD.end.replaceAll("-", ""),
    format: "JSON",
    "time-standard": "UTC",
  }).toString();

  return {
    source: "NASA POWER",
    sourceUrl: url.href,
    requestedLocation: { lat, lon },
    period: { ...PERIOD },
    spatialScope: "grid_cell",
    parameters: PARAMETERS,
  };
}

async function fetchClimate(source: Source, fetcher: typeof fetch, timeoutMs: number): Promise<NasaClimateData> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(source.sourceUrl, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) {
      throw new ClimateUnavailableError(`NASA POWER returned HTTP ${response.status}. Try again later.`, source);
    }

    const payload: unknown = await response.json();
    const data = aggregateClimate(payload);
    if (!data.months.some((month) => month.meanTemperatureC !== null || month.totalPrecipitationMm !== null)) {
      throw new ClimateUnavailableError("NASA POWER returned no complete monthly mean temperature or precipitation totals for this location.", source);
    }

    return {
      ...data,
      provenance: { ...source, kind: "nasa_power", retrievedAt: new Date().toISOString() },
      limitations: [
        "NASA POWER historical estimates describe the grid cell at the selected point and do not measure conditions on the field.",
        "Monthly and annual aggregates require complete daily coverage for each metric. Missing totals or means are null.",
        "Mean temperatures are averaged across days. Period temperature extremes use the hottest daily maximum and coldest daily minimum. Precipitation is summed from daily mm/day values to totals in mm.",
      ],
    };
  } catch (error) {
    if (error instanceof ClimateUnavailableError) throw error;
    if (error instanceof InvalidNasaResponse) throw new ClimateUnavailableError(error.message, source);
    if (controller.signal.aborted) throw new ClimateUnavailableError("NASA POWER request timed out. Try again later.", source);
    if (error instanceof SyntaxError) throw new ClimateUnavailableError("NASA POWER returned invalid JSON. Try again later.", source);
    throw new ClimateUnavailableError("Could not reach NASA POWER or read its response. Try again later.", source);
  } finally {
    clearTimeout(timeout);
  }
}

interface CacheEntry {
  climate: NasaClimateData;
  cachedAt: number;
  refreshAt: number;
  refreshError?: string;
}

function cachedResult(entry: CacheEntry): ClimateData {
  return {
    ...entry.climate,
    provenance: {
      ...entry.climate.provenance,
      kind: "cached_nasa_power",
      cachedAt: new Date(entry.cachedAt).toISOString(),
    },
    limitations: entry.refreshError ? [
      ...entry.climate.limitations,
      `Using previously retrieved NASA POWER history because refresh failed. ${entry.refreshError}`,
    ] : entry.climate.limitations,
  };
}

export function createClimateClient(
  fetcher: typeof fetch = (input, init) => fetch(input, init),
  timeoutMs = 10_000,
) {
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<ClimateData>>();

  return async function getClimate(location: Coordinates): Promise<ClimateData> {
    if (!isCoordinates(location)) throw new RangeError("Latitude and longitude must be finite and within ±90 and ±180 respectively.");

    const source = sourceFor(location);
    const { sourceUrl: key } = source;
    const cached = cache.get(key);
    if (cached) {
      // Touch the entry so that capacity limits evict the least recently used point.
      cache.delete(key);
      cache.set(key, cached);
      if (Date.now() < cached.refreshAt) return cachedResult(cached);
    }

    const pending = inFlight.get(key);
    if (pending) return pending;

    const request = fetchClimate(source, fetcher, timeoutMs).then((climate) => {
      const cachedAt = Date.now();
      cache.set(key, { climate, cachedAt, refreshAt: cachedAt + FRESH_FOR_MS });
      if (cache.size > MAX_CACHE_ENTRIES) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) cache.delete(oldestKey);
      }
      return climate;
    }).catch((error: unknown) => {
      if (!cached || !(error instanceof ClimateUnavailableError)) throw error;
      cached.refreshAt = Date.now() + RETRY_AFTER_MS;
      cached.refreshError = error.message;
      return cachedResult(cached);
    }).finally(() => {
      inFlight.delete(key);
    });

    inFlight.set(key, request);
    return request;
  };
}

export const getClimate = createClimateClient();
