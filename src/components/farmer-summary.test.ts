import { describe, expect, it } from "vitest";
import snapshot from "../data/validation/konya-nasa-power-2021-2025.json";
import { CROP_PROFILES } from "../lib/crops/profiles";
import { assessCropSuitability } from "../lib/crops/suitability";
import { analyzeRotations, findRotationSingleChange } from "../lib/rotation";
import type { ClimateSummary, FieldSelection, RecommendResponse, RotationSequence } from "@/types/api";
import { buildFarmerSummary, cycleName } from "./farmer-summary";

const climate = { ...snapshot, limitations: [] } as unknown as ClimateSummary;
const start = { year: 2027, month: 1 };
const field: FieldSelection = {
  location: { lat: 37.87, lon: 32.48 },
  previousCrop: "wheat",
  irrigation: "unavailable",
};

/** Builds the same shape the route returns, from the same engine the route calls. */
function analyze(currentRotation?: RotationSequence, input: Partial<FieldSelection> = {}) {
  const selection = { ...field, ...input, currentRotation };
  const { rotations, strategies, rotationStressTest } = analyzeRotations(climate, selection, start);
  return {
    suitability: CROP_PROFILES.map((crop) => assessCropSuitability(crop, climate, selection)),
    rotations,
    rotationStrategies: strategies,
    rotationStressTest,
    singleChange: currentRotation && findRotationSingleChange(currentRotation, climate, selection, start),
  } satisfies Partial<RecommendResponse> as Parameters<typeof buildFarmerSummary>[0];
}

describe("farmer summary", () => {
  it("leads with the single change and explains it from the measured difference", () => {
    const summary = buildFarmerSummary(analyze(["wheat", "fallow", "wheat"]), "tr")!;

    expect(summary.headline).toBe("Planınızda tek bir şeyi değiştirin: 1. ekimde buğday yerine nohut.");
    expect(summary.sequence).toEqual(["chickpea", "fallow", "wheat"]);
    expect(summary.reasons[0]).toContain("2 kez kurtarır");
    expect(summary.reasons[1]).toBe("Tarla 8 ay daha az boş kalır.");
    expect(summary.cautions[0]).toContain("sulama olmadan");
    expect(summary.cautions[0]).toContain("ayçiçeği");
    expect(summary.footer).toContain("ziraat mühendisiniz");
  });

  it("says so plainly when the grower's own plan needs no change", () => {
    const summary = buildFarmerSummary(analyze(["lentil", "wheat", "lentil"]), "tr")!;

    expect(summary.headline).toContain("Mevcut planınız bu tarla için uygun");
    expect(summary.reasons).toEqual([]);
    expect(summary.sequence).toEqual(["lentil", "wheat", "lentil"]);
    expect(summary.alternative).toContain("Başka seçenek");
  });

  it("recommends a first crop when the grower entered no plan of their own", () => {
    const summary = buildFarmerSummary(analyze(), "tr", "wheat")!;

    expect(summary.headline).toBe("Gelecek sezon için güçlü seçenek: Nohut");
    expect(summary.sequence).toHaveLength(3);
    expect(summary.reasons[0]).toContain("farklı bir bitki ailesi");
    expect(summary.reasons[1]).toMatch(/^Son yılların yağışı nohut suyunun yaklaşık %\d+'ini karşıladı\.$/);

    // The previous crop is optional, and without it the family sentence is simply left out.
    expect(buildFarmerSummary(analyze(), "tr")!.reasons.some((line) => line.includes("aile"))).toBe(false);
  });

  it("credits water only on an irrigated field, where the grower pays for it", () => {
    const rainfed = buildFarmerSummary(analyze(["maize", "wheat", "chickpea"]), "tr")!;
    const irrigated = buildFarmerSummary(analyze(["maize", "wheat", "chickpea"], { irrigation: "available" }), "tr")!;

    expect(rainfed.reasons.join(" ")).toContain("yetişmesini beklemediğimiz");
    expect(rainfed.reasons.join(" ")).not.toContain("m³");
    expect(irrigated.reasons.join(" ")).toMatch(/dekara yaklaşık \d+ m³ daha az sulama/);
  });

  it("reports the dry-year replay for the sequence it recommends", () => {
    const summary = buildFarmerSummary(analyze(["wheat", "fallow", "wheat"]), "tr")!;
    const stressed = analyze(["wheat", "fallow", "wheat"]).rotationStressTest;

    if (stressed?.plans.some(({ cycles }) => cycles.join(",") === summary.sequence?.join(","))) {
      expect(summary.dryYear).toMatch(/Yıl kurak geçerse: \d{4} gibi bir yılda/);
    } else {
      expect(summary.dryYear).toBeUndefined();
    }
  });

  it("withholds the summary outside the pilot region and translates every line", () => {
    const outside = { ...analyze(), applicability: { status: "outside_validated_region" as const, message: "" } };
    expect(buildFarmerSummary(outside, "tr")).toBeUndefined();

    const turkish = buildFarmerSummary(analyze(["wheat", "fallow", "wheat"]), "tr")!;
    const english = buildFarmerSummary(analyze(["wheat", "fallow", "wheat"]), "en")!;
    expect(english.headline).toBe("Change one thing in your plan: chickpea instead of wheat in cycle 1.");
    expect(english.sequence).toEqual(turkish.sequence);
    expect(english.reasons).toHaveLength(turkish.reasons.length);
    for (const line of [english.headline, ...english.reasons, ...english.cautions, english.footer]) {
      expect(line).not.toMatch(/[çğıöşüÇĞİÖŞÜ]/);
    }
    expect(cycleName("fallow", "tr")).toBe("Nadas");
  });
});
