import type {
  ClimateSummary,
  CropId,
  FieldSelection,
  RotationChange,
  RotationCycle,
  RotationSequence,
  RotationSequenceMeasures,
  SingleChangeResult,
} from "../../types/api";
import { CROP_PROFILES, getCropProfile } from "../crops/profiles";
import { assessCropSuitability } from "../crops/suitability";
import { assessWaterBalance } from "../crops/water-balance";

/**
 * Ranking order for a one-cycle change. Each step is decided before the next is read, so a change
 * never trades a higher step for a lower one. The order follows the strength of the evidence behind
 * each measure: a crop the seasonal water balance rejects cannot be grown here at all; repeating a
 * crop or its botanical family is the effect measured in the Central Anatolia rotation trial; the
 * last two come from the model's own water balance and calendar.
 *
 * Irrigation is only weighed on an irrigated field, where the grower pays for the water. On a rainfed
 * field no irrigation is applied, so the rain a crop needs is already settled by the first step.
 */
const INFEASIBLE_CYCLES = "cycles holding a crop the model will not grow on this field";
const REPEATED_TRANSITIONS = "planted transitions that repeat the preceding crop or its family";
const PEAK_IRRIGATION = "largest modeled irrigation of any one season";
const UNCROPPED_MONTHS = "months without a primary crop";

function rankingSteps(irrigated: boolean): readonly string[] {
  return irrigated
    ? [INFEASIBLE_CYCLES, REPEATED_TRANSITIONS, PEAK_IRRIGATION, UNCROPPED_MONTHS]
    : [INFEASIBLE_CYCLES, REPEATED_TRANSITIONS, UNCROPPED_MONTHS];
}

function methodFor(irrigated: boolean): string {
  const steps = rankingSteps(irrigated).map((step, index) => `${index + 1}) ${step}`).join(", ");
  return `Each cycle is replaced, one at a time, with every other crop and with fallow. The results are ranked by ${steps}, in that order, and ties are broken by crop order.${
    irrigated ? "" : " Irrigation is left out because this field is rainfed."
  }`;
}

type Candidate = RotationCycle;

const CANDIDATES: readonly Candidate[] = [...CROP_PROFILES.map(({ id }) => id), "fallow"];

interface SequenceContext {
  /** An irrigated field pays for water, so irrigation is weighed; a rainfed one does not. */
  irrigated: boolean;
  /** Crops the model will not grow on this field, by id. */
  infeasible: ReadonlySet<CropId>;
  /** Modeled net irrigation per season in mm, which equals m³ per decare. */
  irrigation: ReadonlyMap<CropId, number>;
  previousCrop: CropId;
  summarize: (sequence: RotationSequence) => {
    calendar: SingleChangeResult["current"]["calendar"];
  };
}

/** Counts a transition between planted cycles. A fallow year does not reset the preceding crop. */
function repeatedTransitions(sequence: RotationSequence, previousCrop: CropId): number {
  let last = previousCrop;
  let repeated = 0;
  for (const cycle of sequence) {
    if (cycle === "fallow") continue;
    const from = getCropProfile(last);
    const to = getCropProfile(cycle);
    if (from.id === to.id || from.family === to.family) repeated++;
    last = cycle;
  }
  return repeated;
}

function measureSequence(sequence: RotationSequence, context: SequenceContext): {
  calendar: SingleChangeResult["current"]["calendar"];
  measures: RotationSequenceMeasures;
} {
  const { calendar } = context.summarize(sequence);
  const planted = sequence.filter((cycle): cycle is CropId => cycle !== "fallow");
  const estimates = planted.map((crop) => context.irrigation.get(crop));
  const complete = estimates.every((value) => value !== undefined);

  return {
    calendar,
    measures: {
      infeasibleCycles: planted.filter((crop) => context.infeasible.has(crop)).length,
      repeatedTransitions: repeatedTransitions(sequence, context.previousCrop),
      // A fallow year needs no irrigation, so an all-fallow sequence peaks at zero.
      peakSeasonIrrigationM3PerDa: complete ? Math.max(0, ...estimates as number[]) : undefined,
      uncroppedMonths: calendar.uncroppedMonths,
      totalMonths: calendar.totalMonths,
    },
  };
}

/** Negative when `a` ranks above `b`. Water is compared only when both sides have a full estimate. */
function compareMeasures(a: RotationSequenceMeasures, b: RotationSequenceMeasures, irrigated: boolean): number {
  if (a.infeasibleCycles !== b.infeasibleCycles) return a.infeasibleCycles - b.infeasibleCycles;
  if (a.repeatedTransitions !== b.repeatedTransitions) return a.repeatedTransitions - b.repeatedTransitions;
  const water = a.peakSeasonIrrigationM3PerDa;
  const otherWater = b.peakSeasonIrrigationM3PerDa;
  if (irrigated && water !== undefined && otherWater !== undefined && Math.abs(water - otherWater) > 1e-9) {
    return water - otherWater;
  }
  return a.uncroppedMonths - b.uncroppedMonths;
}

const volume = (value: number) => `${Math.round(value)} m³/da`;

function describe(
  change: RotationSequenceMeasures,
  current: RotationSequenceMeasures,
  irrigated: boolean,
): Pick<RotationChange, "gains" | "tradeoffs"> {
  const gains: string[] = [];
  const tradeoffs: string[] = [];
  const note = (better: boolean, text: string) => (better ? gains : tradeoffs).push(text);

  if (change.infeasibleCycles !== current.infeasibleCycles) {
    const fewer = current.infeasibleCycles - change.infeasibleCycles;
    note(fewer > 0, fewer > 0
      ? `Drops ${fewer} cycle(s) holding a crop the model will not grow on this field.`
      : `Adds ${-fewer} cycle(s) holding a crop the model will not grow on this field.`);
  }
  if (change.repeatedTransitions !== current.repeatedTransitions) {
    const fewer = current.repeatedTransitions - change.repeatedTransitions;
    note(fewer > 0, fewer > 0
      ? `Breaks ${fewer} back-to-back repetition(s) of the same crop or botanical family.`
      : `Adds ${-fewer} back-to-back repetition(s) of the same crop or botanical family.`);
  }
  const water = change.peakSeasonIrrigationM3PerDa;
  const currentWater = current.peakSeasonIrrigationM3PerDa;
  if (!irrigated) {
    // Nothing is applied on a rainfed field, so a difference in modeled irrigation is not a gain.
  } else if (water !== undefined && currentWater !== undefined && Math.abs(water - currentWater) > 0.5) {
    const less = currentWater - water;
    note(less > 0, less > 0
      ? `The thirstiest season needs ${volume(less)} less irrigation (${volume(currentWater)} to ${volume(water)}).`
      : `The thirstiest season needs ${volume(-less)} more irrigation (${volume(currentWater)} to ${volume(water)}).`);
  } else if (water === undefined || currentWater === undefined) {
    tradeoffs.push("Irrigation could not be compared because a cycle has no modeled water estimate.");
  }
  if (change.uncroppedMonths !== current.uncroppedMonths) {
    const fewer = current.uncroppedMonths - change.uncroppedMonths;
    note(fewer > 0, fewer > 0
      ? `The field spends ${fewer} fewer month(s) without a primary crop.`
      : `The field spends ${-fewer} more month(s) without a primary crop.`);
  }

  return { gains, tradeoffs };
}

/**
 * Rank the one-cycle changes a grower could make to their own rotation. Everything compared here is
 * measured by the same model that scores the full plans: nothing about yield or income is implied.
 */
export function findSingleChange(
  currentRotation: RotationSequence,
  climate: ClimateSummary,
  field: FieldSelection,
  summarize: SequenceContext["summarize"],
): SingleChangeResult {
  const infeasible = new Set<CropId>();
  const irrigation = new Map<CropId, number>();
  for (const profile of CROP_PROFILES) {
    const { feasibility } = assessCropSuitability(profile, climate, field);
    if (feasibility.status !== "feasible") infeasible.add(profile.id);
    const { balance, sufficient } = assessWaterBalance(profile, climate, field);
    if (sufficient && balance) irrigation.set(profile.id, balance.netIrrigationRequirementMm);
  }

  const irrigated = field.irrigation === "available";
  const context: SequenceContext = { irrigated, infeasible, irrigation, previousCrop: field.previousCrop, summarize };
  const current = { sequence: currentRotation, ...measureSequence(currentRotation, context) };
  const changes: RotationChange[] = [];

  for (const [index, from] of currentRotation.entries()) {
    for (const to of CANDIDATES) {
      if (to === from) continue;
      const sequence = currentRotation.with(index, to) as unknown as RotationSequence;
      const { calendar, measures } = measureSequence(sequence, context);
      if (compareMeasures(measures, current.measures, irrigated) >= 0) continue;
      changes.push({
        cycle: index + 1,
        from,
        to,
        sequence,
        calendar,
        measures,
        ...describe(measures, current.measures, irrigated),
      });
    }
  }

  changes.sort((a, b) =>
    compareMeasures(a.measures, b.measures, irrigated) || a.cycle - b.cycle ||
    (a.to < b.to ? -1 : a.to > b.to ? 1 : 0),
  );

  const consideredCount = currentRotation.length * (CANDIDATES.length - 1);
  const [best, ...rest] = changes;
  return {
    current,
    best,
    alternatives: rest.slice(0, 2),
    consideredCount,
    method: methodFor(irrigated),
    note: best ? undefined : `No single change to these three cycles ranked above the current rotation on ${rankingSteps(irrigated).join(", ")}.`,
  };
}
