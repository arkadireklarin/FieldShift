import { cropLabels } from "../crop-labels";
import type { ClimateMonth, CropId, RecommendResponse } from "@/types/api";

const temperatures = [1, 3, 7, 12, 17, 22, 25, 24, 19, 13, 7, 2];
const precipitation = [36, 25, 38, 44, 51, null, 9, 0, 17, 31, 37, 46];
const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const scores: [CropId, number][] = [
  ["chickpea", 86], ["barley", 82], ["sunflower", 77],
  ["lentil", 74], ["wheat", 69], ["maize", 48],
];

export interface DevelopmentFixture {
  months: ClimateMonth[];
  recommendation: Omit<RecommendResponse, "climate">;
}

// This fixed fixture is for UI development and has no NASA source or field association.
export const developmentFixture: DevelopmentFixture = {
  months: temperatures.map((meanTemperatureC, index) => ({
    month: `2025-${String(index + 1).padStart(2, "0")}`,
    meanTemperatureC,
    totalPrecipitationMm: precipitation[index],
    expectedDays: days[index],
    temperatureDays: days[index],
    precipitationDays: precipitation[index] === null ? days[index] - 3 : days[index],
  })),
  recommendation: {
    suitability: scores.map(([crop, score], index) => ({
      crop,
      score,
      factors: [
        {
          label: "Seasonal temperature",
          scoreDelta: 10 - index,
          explanation: `The illustrative temperature range aligns with the example ${cropLabels[crop].toLowerCase()} profile.`,
        },
        {
          label: "Rainfall constraint",
          scoreDelta: -2 - index,
          explanation: "The example includes a dry mid-season period.",
        },
      ],
      limitations: ["Illustrative score using a provisional example profile."],
    })),
    rotations: [
      {
        cycles: ["chickpea", "barley", "sunflower"],
        score: 84,
        explanations: ["Starts with a legume, followed by a cereal and an oilseed."],
        limitations: ["Local planting dates and soil conditions would need separate assessment."],
      },
      {
        cycles: ["lentil", "barley", "sunflower"],
        score: 80,
        explanations: ["Uses lentil as the opening legume and keeps three crop families in sequence."],
        limitations: ["Requires checking that lentil is suitable for the actual field."],
      },
      {
        cycles: ["chickpea", "wheat", "sunflower"],
        score: 75,
        explanations: ["Includes wheat as the second primary crop after chickpea."],
        limitations: ["Confirm planting and water availability before using this sequence."],
      },
    ],
    provenance: [{ kind: "assumption", description: "This fixed example assumes a rainfed field and unknown soil pH." }],
    limitations: ["Synthetic development example. All scores and scenarios are illustrative."],
  },
};
