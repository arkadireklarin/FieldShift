import type { ClimateSummary, CropId, FieldSelection, RotationRecommendation } from "../../types/api";
import { CROP_PROFILES, getCropProfile, type AgronomicCropProfile } from "../crops/profiles";
import { assessCropSuitability, assessCropTransition, type SuitabilityFactor } from "../crops/suitability";

interface CycleSchedule {
  crop: CropId;
  /** Inclusive calendar months formatted YYYY-MM. */
  plantingMonth: string;
  harvestMonth: string;
  /** Predecessor compatibility is scored separately in transitions. */
  suitabilityScore: number;
}

interface Transition extends SuitabilityFactor {
  from: CropId;
  to: CropId;
}

export interface RotationPlan extends RotationRecommendation {
  schedule: readonly [CycleSchedule, CycleSchedule, CycleSchedule];
  transitions: readonly [Transition, Transition, Transition];
  components: ReadonlyArray<{ label: string; score: number; weight: number }>;
  assumptions: string[];
}

const WEIGHTS = { suitability: 0.75, transitions: 0.20, familyDiversity: 0.05 };

function monthLabel(index: number): string {
  const year = Math.floor(index / 12);
  const month = String(index % 12 + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function scheduleCrop({ calendar }: AgronomicCropProfile, earliestMonth: number) {
  const plantingWindow = (calendar.plantingEndMonth - calendar.plantingStartMonth + 12) % 12;
  const sinceOpening = (earliestMonth % 12 + 1 - calendar.plantingStartMonth + 12) % 12;
  const planting = earliestMonth + (sinceOpening <= plantingWindow ? 0 : 12 - sinceOpening);
  const harvest = planting + (calendar.growingEndMonth - (planting % 12 + 1) + 12) % 12;
  return { planting, harvest };
}

function compareCropSequences(a: RotationPlan, b: RotationPlan): number {
  const first = a.cycles.join(",");
  const second = b.cycles.join(",");
  return first < second ? -1 : first > second ? 1 : 0;
}

/** Rank upcoming primary crops starting with the first full month available to plant. */
export function rankRotations(
  climate: ClimateSummary,
  field: FieldSelection,
  firstAvailableMonth: { year: number; month: number },
): RotationPlan[] {
  const previous = getCropProfile(field.previousCrop);
  const candidates = CROP_PROFILES.flatMap((profile) => {
    const { score, warnings } = assessCropSuitability(profile, climate, field);
    const temperatureUnsuitable = warnings.some(({ code }) => code === "TEMPERATURE_OUTSIDE_MODEL_RANGE");
    return score === null || temperatureUnsuitable ? [] : [{ profile, score }];
  });
  type Candidate = (typeof candidates)[number];
  const firstMonth = firstAvailableMonth.year * 12 + firstAvailableMonth.month - 1;
  const plans: RotationPlan[] = [];
  const assumptions = [
    `Planning begins in ${monthLabel(firstMonth)} and assumes the previous crop has been harvested by then.`,
    "Uses provisional Central Anatolia main-season windows. Each crop starts in the earliest available planting month, with gaps between cycles when harvest misses the next crop's window.",
    "Each plan uses three different crops. Irrigation availability applies to all cycles, and water constraints are included in crop suitability.",
  ];
  const limitations = [
    "Feasibility requires a valid planting window, enough seasonal climate evidence to score, and some temperature fit when complete active-season temperatures are available. Verify local cultivar, field access and irrigation capacity.",
    "Ranking uses the same historical grid-cell climate for all cycles. Future weather, soil water storage and irrigation quantities are unknown.",
    "Calendar and crop responses are provisional. Check regional applicability when the field is outside Central Anatolia.",
  ];

  function makePlan(sequence: [Candidate, Candidate, Candidate]): RotationPlan {
    const [first, second, third] = sequence.map(({ profile }) => profile);
    const priorCrops = [previous, first, second] as const;
    let availableMonth = firstMonth;
    const schedule = sequence.map(({ profile, score }): CycleSchedule => {
      const { planting, harvest } = scheduleCrop(profile, availableMonth);
      availableMonth = harvest + 1;
      return {
        crop: profile.id,
        plantingMonth: monthLabel(planting),
        harvestMonth: monthLabel(harvest),
        suitabilityScore: score,
      };
    });
    const transitions = sequence.map(({ profile }, index): Transition => {
      const from = priorCrops[index];
      return { ...assessCropTransition(from, profile), from: from.id, to: profile.id };
    });
    const familyDiversity = (new Set(sequence.map(({ profile }) => profile.family)).size - 1) * 50;
    const components = [
      { label: "Mean crop suitability", score: sequence.reduce((sum, crop) => sum + crop.score, 0) / 3, weight: WEIGHTS.suitability },
      { label: "Mean transition compatibility", score: transitions.reduce((sum, step) => sum + step.score, 0) / 3, weight: WEIGHTS.transitions },
      { label: "Botanical family diversity", score: familyDiversity, weight: WEIGHTS.familyDiversity },
    ];
    const score = Math.round(10 * components.reduce((sum, part) => sum + part.score * part.weight, 0)) / 10;

    return {
      cycles: [first.id, second.id, third.id],
      score,
      schedule: [schedule[0], schedule[1], schedule[2]],
      transitions: [transitions[0], transitions[1], transitions[2]],
      components,
      explanations: [
        ...schedule.map(({ crop, plantingMonth, harvestMonth, suitabilityScore }, index) => (
          `Cycle ${index + 1} · ${getCropProfile(crop).name} · plant ${plantingMonth}, harvest ${harvestMonth}, suitability ${suitabilityScore}/100. ${transitions[index].explanation}`
        )),
        `The ranking weights crop suitability at ${100 * WEIGHTS.suitability}%, transition compatibility at ${100 * WEIGHTS.transitions}%, and botanical family diversity at ${100 * WEIGHTS.familyDiversity}%. Each additional family among the three crops adds 50 points to the diversity component.`,
      ],
      assumptions,
      limitations,
    };
  }

  for (const first of candidates) {
    for (const second of candidates) {
      if (second === first) continue;
      for (const third of candidates) {
        if (third === first || third === second) continue;
        plans.push(makePlan([first, second, third]));
      }
    }
  }

  return plans.sort((a, b) => b.score - a.score || compareCropSequences(a, b)).slice(0, 3);
}
