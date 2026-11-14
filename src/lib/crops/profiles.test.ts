import { describe, expect, it } from "vitest";
import { CROP_PROFILES, getCropProfile } from "./profiles";

function monthsFromStart(start: number, month: number): number {
  return (month - start + 12) % 12;
}

describe("crop profile data", () => {
  it("defines the six provisional crops with valid ranges and calendar windows", () => {
    expect(CROP_PROFILES.map(({ id }) => id).sort()).toEqual([
      "barley", "chickpea", "lentil", "maize", "sunflower", "wheat",
    ]);

    for (const profile of CROP_PROFILES) {
      expect(getCropProfile(profile.id)).toBe(profile);
      expect(profile.validationStatus).toBe("provisional");
      expect(profile.references.length).toBeGreaterThan(0);
      expect(profile.temperatureC.min).toBeLessThan(profile.temperatureC.max);
      expect(profile.waterRequirementMm.min).toBeGreaterThan(0);
      expect(profile.waterRequirementMm.min).toBeLessThan(profile.waterRequirementMm.max);
      expect(profile.rootingDepthM.min).toBeGreaterThan(0);
      expect(profile.rootingDepthM.min).toBeLessThan(profile.rootingDepthM.max);
      if (profile.soilPh) {
        expect(profile.soilPh.min).toBeGreaterThanOrEqual(0);
        expect(profile.soilPh.min).toBeLessThan(profile.soilPh.max);
        expect(profile.soilPh.max).toBeLessThanOrEqual(14);
      }

      const calendar = profile.calendar;
      for (const month of Object.values(calendar)) {
        expect(Number.isInteger(month)).toBe(true);
        expect(month).toBeGreaterThanOrEqual(1);
        expect(month).toBeLessThanOrEqual(12);
      }
      const relativeMonth = (month: number) => monthsFromStart(calendar.growingStartMonth, month);
      expect(relativeMonth(calendar.plantingStartMonth)).toBe(0);
      expect(relativeMonth(calendar.plantingEndMonth)).toBeLessThanOrEqual(relativeMonth(calendar.activeStartMonth));
      expect(relativeMonth(calendar.activeStartMonth)).toBeLessThanOrEqual(relativeMonth(calendar.activeEndMonth));
      expect(relativeMonth(calendar.activeEndMonth)).toBeLessThanOrEqual(relativeMonth(calendar.growingEndMonth));
    }
  });
});
