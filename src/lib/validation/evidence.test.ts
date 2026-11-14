import { describe, expect, it } from "vitest";
import { getModelEvidence } from "./evidence";

describe("published field evidence", () => {
  it("agrees with every trial outcome on file", () => {
    const { checks } = getModelEvidence();

    expect(checks.filter(({ agrees }) => !agrees).map(({ id }) => id)).toEqual([]);
    expect(checks.map(({ id }) => id)).toEqual([
      "chickpea-rainfed-water-use", "chickpea-rainfed-yield", "chickpea-irrigation-need",
      "sunflower-rainfed-water-use", "sunflower-control-yield", "sunflower-irrigation-need",
      "sunflower-water-use-held-out", "chickpea-water-use-held-out", "ankara-wheat-rainfed-yield",
      "rainfed-wheat-feasible", "wheat-after-rotation-crop",
    ]);
  });

  it("keeps calibration checks apart from independent outcomes and names what is still untested", () => {
    const { checks, pending, site } = getModelEvidence();

    // The wheat and rotation trials set no parameter. The first two checks swap settings between the calibration trials.
    expect(checks.filter(({ kind }) => kind === "consistency").map(({ source }) => source.url)).toEqual([
      "https://dergipark.org.tr/tr/download/article-file/595097",
      "https://doi.org/10.15316/SJAFS.2022.020",
      "https://doi.org/10.1016/j.agwat.2005.08.005",
      "https://doi.org/10.1016/j.still.2008.09.004",
      "https://doi.org/10.1016/j.still.2008.09.004",
    ]);
    expect(checks.every(({ source }) => source.url.startsWith("https://"))).toBe(true);
    expect(pending).toContain("No on-farm comparison");
    expect(site).toContain("Konya");
  });

  it("reports predictions from the current model", () => {
    const byId = Object.fromEntries(getModelEvidence().checks.map((check) => [check.id, check]));

    expect(byId["chickpea-rainfed-water-use"]).toMatchObject({ observed: "241 mm in non-irrigated plots", predicted: "250 mm from rainfall and stored soil water" });
    expect(byId["chickpea-rainfed-yield"]).toMatchObject({ observed: "48% (0.98 against 2.03 t/ha)", predicted: "53%" });
    expect(byId["sunflower-irrigation-need"]).toMatchObject({ observed: "447 mm applied to fully irrigated plots", predicted: "424 mm" });
    expect(byId["sunflower-water-use-held-out"]).toMatchObject({ observed: "235 mm", predicted: "232 mm" });
    expect(byId["chickpea-water-use-held-out"]).toMatchObject({ observed: "241 mm", predicted: "244 mm" });
    expect(byId["ankara-wheat-rainfed-yield"]).toMatchObject({
      observed: "60% (3.2 against 5.35 t/ha)", predicted: "56% on the Ankara NASA POWER record",
    });
    expect(byId["wheat-after-rotation-crop"].predicted)
      .toBe("Transition score into wheat: 100 after chickpea, 100 after lentil, 70 after sunflower, 5 after wheat");
  });
});
