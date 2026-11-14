import { afterEach, describe, expect, it, vi } from "vitest";
import { aggregateClimate, PARAMETERS } from "./aggregate";
import { ClimateUnavailableError, createClimateClient, isCoordinates } from "./index";

const LOCATION = { lat: 37.57, lon: 32.77 };

function dailyFixture(year = 2024) {
  const series = {
    T2M: {} as Record<string, unknown>,
    T2M_MAX: {} as Record<string, unknown>,
    T2M_MIN: {} as Record<string, unknown>,
    PRECTOTCORR: {} as Record<string, unknown>,
  };
  for (const date = new Date(Date.UTC(year, 0, 1)); date.getUTCFullYear() === year; date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.toISOString().slice(0, 10).replaceAll("-", "");
    const mean = date.getUTCMonth() === 1 ? 10 : 3;
    series.T2M[day] = mean;
    series.T2M_MAX[day] = mean + 4;
    series.T2M_MIN[day] = mean - 4;
    series.PRECTOTCORR[day] = 0.5;
  }
  return {
    header: { fill_value: -888, start: "20210101", end: "20251231", time_standard: "UTC" },
    properties: { parameter: series },
    parameters: {
      T2M: { units: "C" }, T2M_MAX: { units: "C" }, T2M_MIN: { units: "C" }, PRECTOTCORR: { units: "mm/day" },
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("NASA POWER aggregation", () => {
  it("preserves source units and computes daily-weighted temperatures and precipitation totals including leap days", () => {
    const payload = dailyFixture();
    payload.properties.parameter.PRECTOTCORR["20240201"] = 0;
    const result = aggregateClimate(payload);

    expect(result.months).toHaveLength(60);
    expect(result.years).toHaveLength(5);
    expect(result.units).toEqual({
      source: { T2M: "C", T2M_MAX: "C", T2M_MIN: "C", PRECTOTCORR: "mm/day" },
      temperature: "°C",
      precipitationTotal: "mm",
    });
    expect(result.months.find(({ month }) => month === "2024-02")).toEqual({
      month: "2024-02",
      expectedDays: 29,
      temperatureDays: 29,
      maximumTemperatureDays: 29,
      minimumTemperatureDays: 29,
      precipitationDays: 29,
      meanTemperatureC: 10,
      meanDailyMaximumTemperatureC: 14,
      meanDailyMinimumTemperatureC: 6,
      highestDailyMaximumTemperatureC: 14,
      lowestDailyMinimumTemperatureC: 6,
      totalPrecipitationMm: 14,
    });
    expect(result.years.find(({ year }) => year === 2024)).toMatchObject({
      expectedDays: 366,
      meanTemperatureC: (29 * 10 + 337 * 3) / 366,
      meanDailyMaximumTemperatureC: (29 * 14 + 337 * 7) / 366,
      meanDailyMinimumTemperatureC: (29 * 6 - 337) / 366,
      highestDailyMaximumTemperatureC: 14,
      lowestDailyMinimumTemperatureC: -1,
      totalPrecipitationMm: 182.5,
    });
  });

  it("filters sentinels, invalid and absent values without dropping legitimate zero rainfall", () => {
    const payload = dailyFixture();
    const series = payload.properties.parameter;
    series.T2M["20240101"] = -888;
    series.T2M["20240102"] = -999;
    series.T2M["20240103"] = null;
    series.T2M["20240104"] = "3";
    series.T2M["20240105"] = NaN;
    delete series.T2M["20240106"];
    series.PRECTOTCORR["20240229"] = -0.2;
    for (const day of Object.keys(series.PRECTOTCORR).filter((day) => day.startsWith("202401"))) {
      series.PRECTOTCORR[day] = 0;
    }

    const result = aggregateClimate(payload);
    expect(result.months.find(({ month }) => month === "2024-01")).toMatchObject({
      meanTemperatureC: null,
      temperatureDays: 25,
      maximumTemperatureDays: 31,
      minimumTemperatureDays: 31,
      totalPrecipitationMm: 0,
      precipitationDays: 31,
    });
    expect(result.months.find(({ month }) => month === "2024-02")).toMatchObject({
      totalPrecipitationMm: null,
      precipitationDays: 28,
    });
    expect(result.years.find(({ year }) => year === 2024)).toMatchObject({
      temperatureDays: 360,
      precipitationDays: 365,
      meanTemperatureC: null,
      totalPrecipitationMm: null,
    });
    expect(result.months[0]).toMatchObject({
      month: "2021-01", meanTemperatureC: null, totalPrecipitationMm: null, temperatureDays: 0, precipitationDays: 0,
    });
  });

  it("rejects unrecognized units or date metadata to avoid mislabeling returned values", () => {
    const payload = dailyFixture();
    payload.parameters.T2M.units = "F";
    expect(() => aggregateClimate(payload)).toThrow(/units for T2M/);

    payload.header.time_standard = "LST";
    expect(() => aggregateClimate(payload)).toThrow(/different date range or time standard/);
  });
});

describe("NASA POWER client", () => {
  it("accepts numeric coordinate bounds and rejects invalid locations before fetching", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const getClimate = createClimateClient(fetcher);
    expect(isCoordinates({ lat: -90, lon: 180 })).toBe(true);
    expect(isCoordinates({ lat: "37.57", lon: 32.77 })).toBe(false);
    expect(isCoordinates({ lat: NaN, lon: 32.77 })).toBe(false);
    await expect(getClimate({ lat: 37.57, lon: 180.01 })).rejects.toBeInstanceOf(RangeError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("queries the specified point and coalesces requests with cached NASA provenance", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(dailyFixture()));
    const getClimate = createClimateClient(fetcher);
    const [initial, concurrent] = await Promise.all([getClimate(LOCATION), getClimate(LOCATION)]);
    expect(concurrent).toEqual(initial);
    expect(initial.provenance).toMatchObject({
      kind: "nasa_power",
      requestedLocation: LOCATION,
      period: { start: "2021-01-01", end: "2025-12-31" },
      parameters: PARAMETERS,
      spatialScope: "grid_cell",
    });

    const sourceUrl = new URL(initial.provenance.sourceUrl);
    expect(sourceUrl.origin + sourceUrl.pathname).toBe("https://power.larc.nasa.gov/api/temporal/daily/point");
    expect(Object.fromEntries(sourceUrl.searchParams)).toEqual({
      latitude: "37.57", longitude: "32.77", parameters: PARAMETERS.join(","),
      start: "20210101", end: "20251231", format: "JSON", community: "AG", "time-standard": "UTC",
    });
    expect(fetcher).toHaveBeenCalledWith(sourceUrl.href, expect.objectContaining({ signal: expect.any(AbortSignal) }));

    const cached = await getClimate(LOCATION);
    expect(cached.months).toEqual(initial.months);
    expect(cached.provenance).toMatchObject({
      kind: "cached_nasa_power", retrievedAt: initial.provenance.retrievedAt, cachedAt: expect.any(String),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("falls back to matching historical data when a refresh fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T00:00:00Z"));
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(dailyFixture()))
      .mockRejectedValue(new TypeError("Network is down"));
    const getClimate = createClimateClient(fetcher);
    await getClimate(LOCATION);

    vi.setSystemTime(new Date("2026-11-16T00:00:00Z"));
    const cached = await getClimate(LOCATION);
    expect(cached.provenance).toMatchObject({
      kind: "cached_nasa_power", retrievedAt: "2026-11-14T00:00:00.000Z", cachedAt: "2026-11-14T00:00:00.000Z",
    });
    expect(cached.limitations.join(" ")).toMatch(/refresh failed/);
    expect(await getClimate(LOCATION)).toEqual(cached);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(getClimate({ ...LOCATION, lon: 32.78 })).rejects.toBeInstanceOf(ClimateUnavailableError);
  });

  it("reports a timeout separately from a network failure", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const getClimate = createClimateClient(fetcher, 25);
    const timedOut = expect(getClimate(LOCATION)).rejects.toMatchObject({
      message: expect.stringMatching(/timed out/), provenance: { kind: "unavailable", requestedLocation: LOCATION },
    });
    await vi.advanceTimersByTimeAsync(25);
    await timedOut;

    fetcher.mockRejectedValueOnce(new TypeError("Network is down"));
    await expect(getClimate(LOCATION)).rejects.toThrow(/could not reach NASA POWER/i);
  });

  it("does not cache an invalid response or report entirely missing measurements as success", async () => {
    const empty = dailyFixture();
    empty.properties.parameter.T2M = {};
    empty.properties.parameter.PRECTOTCORR = {};
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("bad json"))
      .mockResolvedValueOnce(Response.json(empty))
      .mockResolvedValueOnce(Response.json(dailyFixture()));
    const getClimate = createClimateClient(fetcher);
    await expect(getClimate(LOCATION)).rejects.toThrow(/invalid JSON/);
    await expect(getClimate(LOCATION)).rejects.toThrow(/no complete monthly/);
    await expect(getClimate(LOCATION)).resolves.toMatchObject({ provenance: { kind: "nasa_power" } });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
