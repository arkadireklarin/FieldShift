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

function nasaFixture(lastMonth = 12, dailyRainfall = 2) {
  const temperatures: Record<string, number> = {};
  const rainfall: Record<string, number> = {};
  const start = lastMonth === 12 ? "2021-01-01" : "2024-01-01";
  const end = lastMonth === 12 ? new Date("2026-01-01") : new Date(Date.UTC(2024, lastMonth));
  for (const day = new Date(start); day < end; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10).replaceAll("-", "");
    temperatures[date] = 18;
    rainfall[date] = dailyRainfall;
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
    ["too few current rotation cycles", JSON.stringify({ ...field, currentRotation: ["wheat", "fallow"] }), /exactly three cycles/],
    ["too many current rotation cycles", JSON.stringify({ ...field, currentRotation: ["wheat", "fallow", "wheat", "maize"] }), /exactly three cycles/],
    ["unknown rotation crop", JSON.stringify({ ...field, currentRotation: ["wheat", "fallow", "rice"] }), /supported crop/],
    ["null current rotation", JSON.stringify({ ...field, currentRotation: null }), /current rotation/],
    ["invalid harvest month", JSON.stringify({ ...field, latestFirstHarvest: "2027-13" }), /latest first-harvest month/],
    ["unformatted harvest month", JSON.stringify({ ...field, latestFirstHarvest: "2027-7" }), /YYYY-MM/],
    ["harvest year outside the allowed range", JSON.stringify({ ...field, latestFirstHarvest: "2200-01" }), /1900 to 2199/],
    ["numeric harvest date", JSON.stringify({ ...field, latestFirstHarvest: 202707 }), /latest first-harvest month/],
    ["quota without irrigation", JSON.stringify({ ...field, irrigationQuotaM3PerDa: 0 }), /quota requires irrigation/],
    ["negative irrigation quota", JSON.stringify({ ...field, irrigation: "available", irrigationQuotaM3PerDa: -0.1 }), /quota as a number/],
    ["irrigation quota beyond the supported range", JSON.stringify({ ...field, irrigation: "available", irrigationQuotaM3PerDa: 10000.01 }), /quota as a number/],
    ["string irrigation quota", JSON.stringify({ ...field, irrigation: "available", irrigationQuotaM3PerDa: "0" }), /quota as a number/],
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
      months: expect.arrayContaining([expect.objectContaining({ month: "2024-02", totalPrecipitationMm: 58 })]),
      units: { temperature: "°C", precipitationTotal: "mm" },
      provenance: { kind: "nasa_power", requestedLocation: field.location },
    });
    expect(result.provenance[0]).toEqual(result.climate.provenance);
    expect(result.applicability).toMatchObject({ status: "validated_region", region: { id: "central-anatolia" } });
    expect(result.modelEvidence?.site).toContain("Konya");
    expect(result.modelEvidence?.checks.length).toBeGreaterThan(0);
    expect(result.suitability).toHaveLength(6);
    expect(result.rotations).toHaveLength(3);
    expect(result).not.toHaveProperty("rotationComparison");
    expect(result).not.toHaveProperty("harvestDeadline");
    expect(result).not.toHaveProperty("irrigationQuota");
    expect(result).not.toHaveProperty("rotationStressTest");
    expect(result.rotationStrategies?.flatMap(({ priorities }) => priorities).sort())
      .toEqual(["early-harvest", "family-diversity", "historical-fit"]);
    expect(result.rotationStrategies?.[0].plan).toEqual(result.rotations[0]);
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
      years: expect.arrayContaining([expect.objectContaining({ year: 2024, totalPrecipitationMm: 732 })]),
      provenance: { kind: "cached_nasa_power", retrievedAt: result.climate.provenance.retrievedAt },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns only climate data for a point outside the modeled pilot region", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => Response.json(nasaFixture())));
    const location = { lat: -23.55, lon: -46.63 };
    const response = await POST(recommendRequest(JSON.stringify({
      ...field, location, irrigation: "available", irrigationQuotaM3PerDa: 0,
      currentRotation: ["wheat", "fallow", "wheat"], latestFirstHarvest: "2027-07",
    })));
    expect(response.status).toBe(200);
    const result: RecommendResponse = await response.json();
    expect(result.climate.provenance.requestedLocation).toEqual(location);
    expect(result.applicability?.status).toBe("outside_validated_region");
    expect(result.limitations).toContain(result.applicability?.message);
    expect(result.suitability).toEqual([]);
    expect(result.rotations).toEqual([]);
    expect(result.rotationStrategies).toEqual([]);
    expect(result).not.toHaveProperty("rotationComparison");
    expect(result).not.toHaveProperty("calendarBenchmark");
    expect(result).not.toHaveProperty("harvestDeadline");
    expect(result).not.toHaveProperty("irrigationQuota");
    expect(result).not.toHaveProperty("rotationStressTest");
    expect(result).not.toHaveProperty("modelEvidence");
  });

  it("compares repeating crops and fallow against the actual recommendation calendars", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(nasaFixture()));
    vi.stubGlobal("fetch", fetcher);
    const analyze = async (currentRotation: [string, string, string]) => {
      const response = await POST(recommendRequest(JSON.stringify({ ...field, currentRotation })));
      expect(response.status).toBe(200);
      return await response.json() as RecommendResponse;
    };

    const result = await analyze(["wheat", "fallow", "wheat"]);
    expect(result.rotationComparison?.current).toEqual({
      schedule: [
        { crop: "wheat", plantingMonth: "2027-10", harvestMonth: "2028-07" },
        { crop: "fallow", plantingMonth: "2028-08", harvestMonth: "2029-07" },
        { crop: "wheat", plantingMonth: "2029-10", harvestMonth: "2030-07" },
      ],
      totalMonths: 44,
      uncroppedMonths: 24,
      distinctCropCount: 1,
      distinctFamilyCount: 1,
    });
    expect(result.rotationComparison?.alternatives.map(({ schedule }) => schedule.map(({ crop }) => crop)))
      .toEqual(result.rotations.map(({ cycles }) => cycles));
    expect(result.rotationComparison?.alternatives[0]).toEqual({
      schedule: [
        { crop: "chickpea", plantingMonth: "2027-03", harvestMonth: "2027-08" },
        { crop: "barley", plantingMonth: "2027-10", harvestMonth: "2028-07" },
        { crop: "lentil", plantingMonth: "2029-02", harvestMonth: "2029-07" },
      ],
      totalMonths: 32,
      uncroppedMonths: 10,
      distinctCropCount: 3,
      distinctFamilyCount: 2,
    });

    const fallow = await analyze(["fallow", "fallow", "fallow"]);
    expect(fallow.rotationComparison?.current).toMatchObject({
      totalMonths: 36,
      uncroppedMonths: 36,
      distinctCropCount: 0,
      distinctFamilyCount: 0,
    });
    expect(fallow.rotationComparison?.alternatives).toEqual(result.rotationComparison?.alternatives);
    expect(fallow.rotations).toEqual(result.rotations);
  });

  it("applies an inclusive first-harvest deadline and keeps the current rotation in a no-match result", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => Response.json(nasaFixture())));
    const analyze = async (latestFirstHarvest: string): Promise<RecommendResponse> => {
      const response = await POST(recommendRequest(JSON.stringify({
        ...field,
        currentRotation: ["wheat", "fallow", "wheat"],
        latestFirstHarvest,
      })));
      expect(response.status).toBe(200);
      return response.json();
    };

    const matched = await analyze("2027-07");
    expect(matched.harvestDeadline).toEqual({
      month: "2027-07", candidateCount: 120, matchingCount: 20, earliestPossibleMonth: "2027-07",
    });
    expect(matched.rotationStrategies?.[0].calendar.schedule[0].harvestMonth).toBe("2027-07");
    expect(matched.rotationComparison?.alternatives.every(({ schedule }) => schedule[0].harvestMonth === "2027-07")).toBe(true);

    const unmatched = await analyze("2026-10");
    expect(unmatched.harvestDeadline).toEqual({
      month: "2026-10", candidateCount: 120, matchingCount: 0, earliestPossibleMonth: "2027-07",
    });
    expect(unmatched.rotations).toEqual([]);
    expect(unmatched.rotationStrategies).toEqual([]);
    expect(unmatched.rotationComparison).toEqual({ current: matched.rotationComparison?.current, alternatives: [] });
    expect(unmatched.limitations).toContain("No eligible rotation has a first modeled harvest by 2026-10.");
  });

  it("distinguishes insufficient evidence from candidates excluded by the deadline", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => Response.json(nasaFixture(1))));
    const response = await POST(recommendRequest(JSON.stringify({
      ...field, location: { lat: 37.58, lon: 32.77 }, latestFirstHarvest: "2027-07",
    })));
    expect(response.status).toBe(200);
    const result: RecommendResponse = await response.json();
    expect(result.harvestDeadline).toEqual({ month: "2027-07", matchingCount: 0, candidateCount: 0 });
    expect(result.rotations).toEqual([]);
    expect(result.limitations).toContain("A rotation requires at least three distinct crops that meet the seasonal climate and calendar criteria.");
  });

  it("passes a zero irrigation quota through to constrained analysis", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => Response.json(nasaFixture(12, 0))));
    const response = await POST(recommendRequest(JSON.stringify({
      ...field,
      location: { lat: 37.62, lon: 32.77 },
      irrigation: "available",
      irrigationQuotaM3PerDa: 0,
      currentRotation: ["wheat", "fallow", "wheat"],
      latestFirstHarvest: "2027-07",
    })));
    expect(response.status).toBe(200);
    const result: RecommendResponse = await response.json();
    expect(result.harvestDeadline?.matchingCount).toBeGreaterThan(0);
    expect(result.irrigationQuota).toMatchObject({ limitM3PerDa: 0, matchingCount: 0 });
    expect(result.irrigationQuota?.candidateCount).toBe(result.harvestDeadline?.matchingCount);
    expect(result.irrigationQuota?.minimumRequiredM3PerDa).toBeGreaterThan(0);
    expect(result.rotations).toEqual([]);
    expect(result.rotationStrategies).toEqual([]);
    expect(result.calendarBenchmark?.baseline.fitsQuota).toBe(false);
    expect(result.rotationComparison?.current.schedule.map(({ crop }) => crop)).toEqual(["wheat", "fallow", "wheat"]);
    expect(result.calendarBenchmark?.selected).toBeUndefined();
    expect(result.limitations).toContain("No eligible rotation with a modeled net irrigation estimate fits the 0 m³ per decare quota.");
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
