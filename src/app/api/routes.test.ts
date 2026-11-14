import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecommendResponse } from "../../types/api";
import { GET } from "./climate/route";
import { POST } from "./recommend/route";

const field = {
  location: { lat: 37.57, lon: 32.77 },
  previousCrop: "wheat",
  irrigation: "unavailable",
};

function climateRequest(query: string) {
  return new Request(`http://localhost/api/climate?${query}`);
}

function recommendRequest(body: string) {
  return new Request("http://localhost/api/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

function nasaFixture() {
  const temperatures: Record<string, number> = {};
  const rainfall: Record<string, number> = {};
  for (const day = new Date("2024-01-01"); day.getUTCFullYear() === 2024; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10).replaceAll("-", "");
    temperatures[date] = 18;
    rainfall[date] = 1;
  }
  return {
    header: { fill_value: -999, start: "20210101", end: "20251231", time_standard: "UTC" },
    parameters: {
      T2M: { units: "C" }, T2M_MAX: { units: "C" }, T2M_MIN: { units: "C" }, PRECTOTCORR: { units: "mm/day" },
    },
    properties: { parameter: { T2M: temperatures, PRECTOTCORR: rainfall } },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("FieldShift API", () => {
  it.each(["lat=&lon=32.77", "lat=37.57", "lat=91&lon=0", "lat=0&lon=181", "lat=0x25&lon=0",
    "lat=37&lat=38&lon=32.77", "lat=37&lon=Infinity"])("rejects bad query coordinates (%s)", async (query) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    const response = await GET(climateRequest(query));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_INPUT", message: expect.stringMatching(/lat.*lon/) } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{", /valid JSON/],
    ["incorrect body shape", "[]", /JSON object/],
    ["unknown crop", JSON.stringify({ ...field, previousCrop: "unknown" }), /previous crop/],
    ["invalid irrigation", JSON.stringify({ ...field, irrigation: true }), /irrigation/],
    ["missing coordinates", JSON.stringify({ ...field, location: undefined }), /numeric location/],
    ["empty coordinate", JSON.stringify({ ...field, location: { lat: "", lon: 32.77 } }), /numeric location/],
    ["string coordinates", JSON.stringify({ ...field, location: { lat: "37.57", lon: 32.77 } }), /numeric location/],
    ["out-of-range coordinate", JSON.stringify({ ...field, location: { lat: 37.57, lon: 181 } }), /numeric location/],
    ["invalid pH", JSON.stringify({ ...field, measuredSoilPh: 15 }), /measured soil pH/],
    ["invalid boundary", JSON.stringify({ ...field, polygon: [field.location] }), /field boundary/],
  ] as const)("rejects %s", async (_name, body, message) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    const response = await POST(recommendRequest(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_INPUT", message: expect.stringMatching(message) } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns typed climate errors with NASA provenance for both routes", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockRejectedValueOnce(new TypeError("connection reset"));
    vi.stubGlobal("fetch", fetcher);

    const climate = await GET(climateRequest("lat=38&lon=32.77"));
    const recommend = await POST(recommendRequest(JSON.stringify({ ...field, location: { lat: 38, lon: 32.77 } })));
    for (const [response, message] of [[climate, /NASA POWER returned HTTP 429/], [recommend, /Could not reach NASA POWER/]] as const) {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: {
          code: "CLIMATE_UNAVAILABLE",
          message: expect.stringMatching(message),
          provenance: expect.objectContaining({ kind: "unavailable", sourceUrl: expect.stringContaining("power.larc.nasa.gov") }),
        },
      });
    }
  });

  it("returns the scoring climate and three plans from a single analysis request", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // It is already December locally, so the first full planning month is January.
    vi.setSystemTime(new Date("2026-11-30T21:00:00Z"));
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(nasaFixture()));
    vi.stubGlobal("fetch", fetcher);

    const polygon = [
      { lat: 37.56, lon: 32.76 }, { lat: 37.58, lon: 32.76 }, { lat: 37.57, lon: 32.78 },
    ];
    const recommend = await POST(recommendRequest(JSON.stringify({ ...field, polygon })));
    expect(recommend.status).toBe(200);
    const result: RecommendResponse = await recommend.json();
    expect(result.climate).toMatchObject({
      months: expect.arrayContaining([expect.objectContaining({ month: "2024-02", totalPrecipitationMm: 29 })]),
      units: { temperature: "°C", precipitationTotal: "mm" },
      provenance: { kind: "nasa_power", requestedLocation: field.location },
    });
    expect(result.provenance[0]).toEqual(result.climate.provenance);
    expect(result.suitability).toHaveLength(6);
    expect(result.rotations).toHaveLength(3);
    expect(result.rotations[0]).toMatchObject({
      cycles: [expect.any(String), expect.any(String), expect.any(String)],
      score: expect.any(Number),
      schedule: Array(3).fill(expect.objectContaining({ suitabilityScore: expect.any(Number) })),
      transitions: Array(3).fill(expect.objectContaining({ code: expect.any(String), explanation: expect.any(String) })),
      assumptions: expect.arrayContaining([expect.stringContaining("2027-01")]),
    });
    const climate = await GET(climateRequest("lat=37.57&lon=32.77"));
    expect(climate.status).toBe(200);
    expect(await climate.json()).toMatchObject({
      months: result.climate.months,
      years: expect.arrayContaining([expect.objectContaining({ year: 2024, totalPrecipitationMm: 366 })]),
      provenance: { kind: "cached_nasa_power", retrievedAt: result.climate.provenance.retrievedAt },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reuses history across repeated analysis, irrigation and crop-family changes, and omits unknown pH", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(nasaFixture()));
    vi.stubGlobal("fetch", fetcher);
    const rainfed = { ...field, location: { lat: 37.5667, lon: 32.775 } };
    const analyze = async (input: typeof rainfed): Promise<RecommendResponse> => {
      const response = await POST(recommendRequest(JSON.stringify(input)));
      expect(response.status).toBe(200);
      return response.json();
    };

    const initial = await analyze(rainfed);
    const [repeated, irrigated, legume] = await Promise.all([
      analyze(rainfed), analyze({ ...rainfed, irrigation: "available" }), analyze({ ...rainfed, previousCrop: "lentil" }),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(repeated.rotations).toEqual(initial.rotations);
    expect(repeated.suitability).toEqual(initial.suitability);
    expect(irrigated.climate.months).toEqual(initial.climate.months);
    expect(legume.climate.months).toEqual(initial.climate.months);
    const rainfedMaize = initial.suitability.find(({ crop }) => crop === "maize");
    const irrigatedMaize = irrigated.suitability.find(({ crop }) => crop === "maize");
    expect(irrigatedMaize?.score ?? -Infinity).toBeGreaterThan(rainfedMaize?.score ?? Infinity);
    expect(initial.suitability.every(({ limitations }) => limitations.some((item) => item.includes("Soil pH was omitted")))).toBe(true);
    expect(initial.rotations[0].explanations[0]).toContain("Wheat");
    expect(legume.rotations[0].explanations[0]).toContain("Lentil");
    expect(legume.rotations).not.toEqual(initial.rotations);
  });
});
