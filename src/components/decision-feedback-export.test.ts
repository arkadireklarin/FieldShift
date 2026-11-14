import { describe, expect, it } from "vitest";
import { decisionFeedbackCsv, isParticipantCode, participantCodePattern } from "./decision-feedback-export";

describe("pilot decision export", () => {
  it("uses a valid browser pattern and accepts only study-code characters", () => {
    const browserPattern = new RegExp(`^${participantCodePattern}$`, "v");
    for (const code of ["C-01", "1", "C01", "A".repeat(24)]) {
      expect(browserPattern.test(code)).toBe(true);
      expect(isParticipantCode(code)).toBe(true);
    }
    for (const code of ["", "-01", "C_01", "C 01", "=123", "A".repeat(25)]) {
      expect(browserPattern.test(code)).toBe(false);
      expect(isParticipantCode(code)).toBe(false);
    }
  });

  it("exports intent, choice and both crop sequences without exporting the field point", () => {
    const csv = decisionFeedbackCsv({
      participantCode: "C-01",
      initialIntent: "keep-current",
      selection: "plan-1",
      currentSequence: ["wheat", "fallow", "wheat"],
      sequence: ["chickpea", "wheat", "lentil"],
      reason: "timing",
      harvestDeadline: "2027-07",
      irrigationQuota: 0,
      provenance: {
        kind: "nasa_power",
        source: "NASA POWER",
        sourceUrl: "https://example.com/?lat=37.5667&lon=32.775",
        requestedLocation: { lat: 37.5667, lon: 32.775 },
        period: { start: "2021-01-01", end: "2025-12-31" },
        spatialScope: "grid_cell",
        parameters: ["T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR"],
        retrievedAt: "2026-11-14T07:00:00Z",
      },
    }, new Date("2026-11-14T08:00:00Z"));

    expect(csv.split("\r\n")[1]).toBe(
      '"C-01","2026-11-14T08:00:00.000Z","keep-current","plan-1","wheat > fallow > wheat","chickpea > wheat > lentil","timing","nasa_power","2021-01-01","2025-12-31","2027-07","0"',
    );
    expect(csv).not.toMatch(/37\.5667|32\.775|https:/);
  });
});
