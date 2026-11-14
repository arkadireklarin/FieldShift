import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiError, FieldSelection } from "@/types/api";
import { requestRecommendation } from "./field-api";

const field = {
  location: { lat: 37.5667, lon: 32.775 },
  previousCrop: "wheat",
  irrigation: "unavailable",
} satisfies FieldSelection;

afterEach(() => vi.unstubAllGlobals());

describe("analysis requests", () => {
  it("requires historical climate in the analysis response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      suitability: [],
      rotations: [],
      provenance: [],
      limitations: [],
    }));
    vi.stubGlobal("fetch", fetcher);

    const result = await requestRecommendation(field, new AbortController().signal);

    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/recommend", expect.objectContaining({
      method: "POST",
      body: JSON.stringify(field),
    }));
    expect(result).toMatchObject({
      status: "error",
      error: { message: expect.stringContaining("unexpected response") },
    });
  });

  it("preserves the typed error from an unavailable climate request", async () => {
    const error = {
      code: "CLIMATE_UNAVAILABLE",
      message: "NASA POWER returned HTTP 503. Try again later.",
    } satisfies ApiError["error"];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error }, { status: 503 })));

    await expect(requestRecommendation(field, new AbortController().signal)).resolves.toEqual({
      status: "error",
      error,
    });
  });
});
