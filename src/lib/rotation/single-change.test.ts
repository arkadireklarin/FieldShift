import { describe, expect, it } from "vitest";
import snapshot from "../../data/validation/konya-nasa-power-2021-2025.json";
import type { ClimateSummary, FieldSelection, RotationSequence } from "../../types/api";
import { findRotationSingleChange } from "./index";

const konya = snapshot as unknown as ClimateSummary;
const start = { year: 2027, month: 1 };
const field: FieldSelection = {
  location: { lat: 37.87, lon: 32.48 },
  previousCrop: "wheat",
  irrigation: "unavailable",
};

function change(currentRotation: RotationSequence, input: Partial<FieldSelection> = {}) {
  return findRotationSingleChange(currentRotation, konya, { ...field, ...input }, start);
}

describe("single change to the grower's own rotation", () => {
  it("replaces one cycle of wheat, fallow, wheat and reports what it gains", () => {
    const result = change(["wheat", "fallow", "wheat"]);

    // Wheat after wheat twice over, because a fallow year does not reset the preceding crop.
    expect(result.current.measures).toMatchObject({ repeatedTransitions: 2, uncroppedMonths: 23 });
    expect(result.consideredCount).toBe(18);
    expect(result.best).toMatchObject({ cycle: 1, from: "wheat", to: "chickpea" });
    expect(result.best?.sequence).toEqual(["chickpea", "fallow", "wheat"]);
    expect(result.best?.measures).toMatchObject({ repeatedTransitions: 0, uncroppedMonths: 15 });
    expect(result.best?.gains).toEqual([
      "Breaks 2 back-to-back repetition(s) of the same crop or botanical family.",
      "The field spends 8 fewer month(s) without a primary crop.",
    ]);
    expect(result.note).toBeUndefined();
  });

  it("changes only one cycle and keeps the other two", () => {
    const current: RotationSequence = ["wheat", "fallow", "barley"];
    for (const option of [change(current).best, ...change(current).alternatives]) {
      expect(option).toBeDefined();
      const changed = option!.sequence.filter((crop, index) => crop !== current[index]);
      expect(changed).toEqual([option!.to]);
      expect(option!.sequence[option!.cycle - 1]).toBe(option!.to);
    }
  });

  it("drops a crop the rainfed water balance rejects before anything else", () => {
    const result = change(["maize", "wheat", "chickpea"]);

    expect(result.current.measures.infeasibleCycles).toBe(1);
    expect(result.best).toMatchObject({ cycle: 1, from: "maize" });
    expect(result.best?.measures.infeasibleCycles).toBe(0);
    expect(result.best?.gains[0]).toContain("the model will not grow on this field");

    // The same rotation is feasible once the field is irrigated, so the water screen stops deciding.
    const irrigated = change(["maize", "wheat", "chickpea"], { irrigation: "available" });
    expect(irrigated.current.measures.infeasibleCycles).toBe(0);
    expect(irrigated.best?.gains.join(" ")).not.toContain("will not grow");
  });

  it("counts irrigation on an irrigated field and leaves it out on a rainfed one", () => {
    const irrigated = change(["maize", "wheat", "chickpea"], { irrigation: "available" });
    const water = irrigated.best!.measures.peakSeasonIrrigationM3PerDa!;

    expect(water).toBeLessThan(irrigated.current.measures.peakSeasonIrrigationM3PerDa!);
    expect(irrigated.best?.gains.join(" ")).toMatch(/thirstiest season needs \d+ m³\/da less irrigation/);
    expect(irrigated.method).toContain("largest modeled irrigation");

    // Nothing is applied on a rainfed field, so a change is never credited or charged for water.
    const rainfed = change(["maize", "wheat", "chickpea"]);
    expect(rainfed.method).toContain("rainfed");
    expect([rainfed.best!, ...rainfed.alternatives].flatMap(({ gains, tradeoffs }) => [...gains, ...tradeoffs]))
      .not.toContain(expect.stringContaining("irrigation"));
  });

  it("offers nothing when no change ranks above the current rotation", () => {
    const result = change(["lentil", "wheat", "lentil"]);

    expect(result.best).toBeUndefined();
    expect(result.alternatives).toEqual([]);
    expect(result.note).toContain("No single change");
    expect(result.current.measures).toMatchObject({ infeasibleCycles: 0, repeatedTransitions: 0 });

    // What it offers for another rotation is itself a rotation it would leave alone.
    const improved = change(["lentil", "wheat", "chickpea"]).best!;
    expect(change(improved.sequence).best).toBeUndefined();
  });

  it("ranks every offered change above the current rotation and below the one before it", () => {
    const result = change(["wheat", "wheat", "wheat"]);
    const offered = [result.best!, ...result.alternatives];
    const rank = ({ infeasibleCycles, repeatedTransitions, uncroppedMonths }: typeof result.current.measures) =>
      [infeasibleCycles, repeatedTransitions, uncroppedMonths];

    expect(offered.length).toBeGreaterThan(1);
    for (const option of offered) {
      expect(option.gains.length).toBeGreaterThan(0);
      expect(rank(option.measures) <= rank(result.current.measures)).toBe(true);
    }
    expect(result.method).toContain("one at a time");
  });

  it("treats fallow as a cycle that needs no irrigation and repeats no family", () => {
    const result = change(["fallow", "fallow", "fallow"]);

    expect(result.current.measures).toMatchObject({
      infeasibleCycles: 0, repeatedTransitions: 0, peakSeasonIrrigationM3PerDa: 0, uncroppedMonths: 36,
    });
    expect(result.best).toMatchObject({ cycle: 1, from: "fallow" });
    expect(result.best?.gains).toEqual(["The field spends 11 fewer month(s) without a primary crop."]);

    // On an irrigated field every crop costs water that three fallow years do not, so none ranks above.
    expect(change(["fallow", "fallow", "fallow"], { irrigation: "available" }).best).toBeUndefined();
  });
});
