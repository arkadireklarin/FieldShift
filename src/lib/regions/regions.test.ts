import { describe, expect, it } from "vitest";
import { describeApplicability, findServiceRegion } from "./index";

describe("validated service region", () => {
  it.each([
    ["Çumra", 37.5667, 32.775], ["Konya", 37.87, 32.48], ["Karaman", 37.18, 33.22], ["Ereğli", 37.51, 34.05],
    ["Niğde", 37.97, 34.68], ["Aksaray", 38.37, 34.03], ["Kayseri", 38.72, 35.48], ["Kırşehir", 39.15, 34.16],
    ["Yozgat", 39.82, 34.8], ["Sivas", 39.75, 37.02], ["Ankara", 39.93, 32.86], ["Haymana", 39.43, 32.5],
    ["Çankırı", 40.6, 33.62], ["Eskişehir", 39.77, 30.52], ["Karapınar", 37.72, 33.55], ["Akşehir", 38.36, 31.42],
  ])("includes %s", (_name, lat, lon) => {
    expect(findServiceRegion({ lat, lon })?.id).toBe("central-anatolia");
  });

  it.each([
    ["Melbourne", -37.81, 144.96], ["Adana", 37.0, 35.32], ["Mersin", 36.8, 34.63], ["Antalya", 36.9, 30.7],
    ["Isparta", 37.76, 30.55], ["Afyonkarahisar", 38.76, 30.54], ["Kütahya", 39.42, 29.98], ["Bolu", 40.73, 31.61],
    ["Kastamonu", 41.38, 33.78], ["Çorum", 40.55, 34.95], ["Tokat", 40.31, 36.55], ["Erzincan", 39.75, 39.49],
    ["Malatya", 38.35, 38.31], ["Kahramanmaraş", 37.58, 36.93], ["İstanbul", 41.01, 28.98], ["Null Island", 0, 0],
  ])("excludes %s", (_name, lat, lon) => {
    expect(findServiceRegion({ lat, lon })).toBeUndefined();
  });

  it("explains that plans are withheld outside the region", () => {
    expect(describeApplicability(findServiceRegion({ lat: 37.5667, lon: 32.775 }))).toEqual({
      status: "validated_region",
      region: { id: "central-anatolia", name: "Central Anatolia" },
      message: expect.stringMatching(/approximate Central Anatolia pilot area.*provisional/),
    });
    expect(describeApplicability(undefined)).toMatchObject({
      status: "outside_validated_region",
      message: expect.stringMatching(/outside the approximate Central Anatolia pilot area.*NASA POWER climate history/),
    });
    expect(describeApplicability(undefined)).not.toHaveProperty("region");
  });
});
