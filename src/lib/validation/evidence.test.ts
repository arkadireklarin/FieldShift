import { describe, expect, it } from "vitest";
import { getModelEvidence } from "./evidence";

describe("published field evidence", () => {
  it("agrees with every trial outcome on file", () => {
    const { checks } = getModelEvidence();

    expect(checks.filter(({ agrees }) => !agrees).map(({ id }) => id)).toEqual([]);
    expect(checks.map(({ id }) => id)).toEqual([
      "chickpea-rainfed-water-use", "chickpea-rainfed-yield", "chickpea-irrigation-need",
      "sunflower-rainfed-water-use", "sunflower-control-yield", "sunflower-irrigation-need",
      "rainfed-wheat-feasible", "wheat-after-rotation-crop",
    ]);
  });

  it("keeps calibration checks apart from independent outcomes and names what is still untested", () => {
    const { checks, pending, site } = getModelEvidence();

    expect(checks.filter(({ kind }) => kind === "consistency").map(({ source }) => source.url))
      .toEqual(Array(2).fill("https://doi.org/10.1016/j.still.2008.09.004"));
    expect(checks.every(({ source }) => source.url.startsWith("https://"))).toBe(true);
    expect(pending).toContain("No on-farm comparison");
    expect(site).toContain("Konya");
  });

  it("reports predictions from the current model", () => {
    const byId = Object.fromEntries(getModelEvidence().checks.map((check) => [check.id, check]));

    expect(byId["chickpea-rainfed-water-use"]).toMatchObject({ observed: "241 mm in non-irrigated plots", predicted: "250 mm from rainfall and stored soil water" });
    expect(byId["chickpea-rainfed-yield"]).toMatchObject({ observed: "48% (0.98 against 2.03 t/ha)", predicted: "53%" });
    expect(byId["sunflower-irrigation-need"]).toMatchObject({ observed: "447 mm applied to fully irrigated plots", predicted: "424 mm" });
    expect(byId["wheat-after-rotation-crop"].predicted)
      .toBe("Transition score into wheat: 100 after chickpea, 100 after lentil, 70 after sunflower, 5 after wheat");
  });
});
