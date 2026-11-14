import type {
  CalendarBenchmark,
  ClimateSummary,
  CropId,
  FieldSelection,
  HarvestDeadlineResult,
  IrrigationQuotaResult,
  RecommendResponse,
  RotationCalendar,
  RotationPriority,
  RotationRecommendation,
  RotationSequence,
  RotationStrategy,
  RotationStressTest,
} from "../../types/api";
import { CROP_PROFILES, getCropProfile, type AgronomicCropProfile } from "../crops/profiles";
import { assessCropSuitability, assessCropTransition, type SuitabilityFactor } from "../crops/suitability";
import { assessWaterBalance } from "../crops/water-balance";
import { buildHistoricalStress } from "./historical-stress";

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
const FALLOW_MONTHS = 12;

function monthIndex(year: number, month: number): number {
  return year * 12 + month - 1;
}

function parseMonth(label: string): number {
  const [year, month] = label.split("-").map(Number);
  return monthIndex(year, month);
}

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

function scheduleSequence(crops: RotationSequence, firstMonth: number): [CalendarPeriod, CalendarPeriod, CalendarPeriod] {
  let availableMonth = firstMonth;
  const [first, second, third] = crops.map((crop): CalendarPeriod => {
    const { planting, harvest } = crop === "fallow"
      ? { planting: availableMonth, harvest: availableMonth + FALLOW_MONTHS - 1 }
      : scheduleCrop(getCropProfile(crop), availableMonth);
    availableMonth = harvest + 1;
    return { crop, plantingMonth: monthLabel(planting), harvestMonth: monthLabel(harvest) };
  });
  return [first, second, third];
}

type CalendarPeriod = RotationCalendar["schedule"][number];

function countCropFamilies(crops: Iterable<CropId>): number {
  return new Set(Array.from(crops, (crop) => getCropProfile(crop).family)).size;
}

function summarizeCalendar(
  schedule: readonly [CalendarPeriod, CalendarPeriod, CalendarPeriod],
  firstMonth: number,
): RotationCalendar {
  const totalMonths = parseMonth(schedule[2].harvestMonth) - firstMonth + 1;
  const crops = new Set<CropId>();
  let croppedMonths = 0;
  for (const { crop, plantingMonth, harvestMonth } of schedule) {
    if (crop === "fallow") continue;
    crops.add(crop);
    croppedMonths += parseMonth(harvestMonth) - parseMonth(plantingMonth) + 1;
  }

  return {
    schedule: schedule.map(({ crop, plantingMonth, harvestMonth }) => ({ crop, plantingMonth, harvestMonth })),
    totalMonths,
    uncroppedMonths: totalMonths - croppedMonths,
    distinctCropCount: crops.size,
    distinctFamilyCount: countCropFamilies(crops),
  };
}

export function compareRotationCalendars(
  currentRotation: RotationSequence,
  rotations: readonly RotationPlan[],
  firstAvailableMonth: { year: number; month: number },
): NonNullable<RecommendResponse["rotationComparison"]> {
  const firstMonth = monthIndex(firstAvailableMonth.year, firstAvailableMonth.month);

  return {
    current: summarizeCalendar(scheduleSequence(currentRotation, firstMonth), firstMonth),
    alternatives: rotations.map(({ schedule }) => summarizeCalendar(schedule, firstMonth)),
  };
}

function compareCropSequences(a: Pick<RotationPlan, "cycles">, b: Pick<RotationPlan, "cycles">): number {
  const first = a.cycles.join(",");
  const second = b.cycles.join(",");
  return first < second ? -1 : first > second ? 1 : 0;
}

function distinctSequences<T>(candidates: readonly T[]): [T, T, T][] {
  const sequences: [T, T, T][] = [];
  for (const first of candidates) {
    for (const second of candidates) {
      if (second === first) continue;
      for (const third of candidates) {
        if (third === first || third === second) continue;
        sequences.push([first, second, third]);
      }
    }
  }
  return sequences;
}

function enumerateRankedRotations(
  climate: ClimateSummary,
  field: FieldSelection,
  firstMonth: number,
): RotationPlan[] {
  const previous = getCropProfile(field.previousCrop);
  const candidates = CROP_PROFILES.flatMap((profile) => {
    const { score, feasibility } = assessCropSuitability(profile, climate, field);
    return score !== null && feasibility.status === "feasible" ? [{ profile, score }] : [];
  });
  type Candidate = (typeof candidates)[number];
  const assumptions = [
    `Planning begins in ${monthLabel(firstMonth)} and assumes the previous crop has been harvested by then.`,
    "Uses provisional Central Anatolia main-season windows. Each crop starts in the earliest available planting month, with gaps between cycles when harvest misses the next crop's window.",
    "Each plan uses three different crops. Irrigation availability applies to all cycles, and water constraints are included in crop suitability.",
  ];
  const limitations = [
    "Plans use crops with enough complete seasons of temperature and rainfall, some temperature fit, and on rainfed fields a modeled yield share at or above the water screening threshold. Verify local cultivar, field access and irrigation capacity.",
    "Ranking uses historical grid-cell climate and an approximate water balance. Verify soil storage and irrigation available at the root zone locally.",
    "Calendars and crop responses are provisional estimates for Central Anatolia.",
  ];

  function makePlan(sequence: [Candidate, Candidate, Candidate]): RotationPlan {
    const [first, second, third] = sequence.map(({ profile }) => profile);
    const cycles = [first.id, second.id, third.id] as const;
    const priorCrops = [previous, first, second] as const;
    const schedule = scheduleSequence(cycles, firstMonth).map(({ plantingMonth, harvestMonth }, index): CycleSchedule => ({
      crop: cycles[index], plantingMonth, harvestMonth, suitabilityScore: sequence[index].score,
    }));
    const transitions = sequence.map(({ profile }, index): Transition => {
      const from = priorCrops[index];
      return { ...assessCropTransition(from, profile), from: from.id, to: profile.id };
    });
    const familyDiversity = (countCropFamilies(cycles) - 1) * 50;
    const components = [
      { label: "Mean crop suitability", score: sequence.reduce((sum, crop) => sum + crop.score, 0) / 3, weight: WEIGHTS.suitability },
      { label: "Mean transition compatibility", score: transitions.reduce((sum, step) => sum + step.score, 0) / 3, weight: WEIGHTS.transitions },
      { label: "Botanical family diversity", score: familyDiversity, weight: WEIGHTS.familyDiversity },
    ];
    const score = Math.round(10 * components.reduce((sum, part) => sum + part.score * part.weight, 0)) / 10;

    return {
      cycles,
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

  return distinctSequences(candidates).map(makePlan).sort((a, b) => b.score - a.score || compareCropSequences(a, b));
}

/** Rank upcoming primary crops starting with the first full month available to plant. */
export function rankRotations(
  climate: ClimateSummary,
  field: FieldSelection,
  firstAvailableMonth: { year: number; month: number },
): RotationPlan[] {
  return analyzeRotations(climate, field, firstAvailableMonth).rotations;
}

function byHarvestDeadline(plans: RotationPlan[], deadline: string | undefined) {
  return deadline ? plans.filter((plan) => plan.schedule[0].harvestMonth <= deadline) : plans;
}

function seasonalWaterByCrop(climate: ClimateSummary, field: FieldSelection) {
  return new Map(CROP_PROFILES.map((profile) => {
    const water = assessWaterBalance(profile, climate, field);
    return [profile.id, water.sufficient ? water.balance?.netIrrigationRequirementMm : undefined] as const;
  }));
}

function peakSeasonWater(cycles: RotationPlan["cycles"], water: ReturnType<typeof seasonalWaterByCrop>) {
  const [first, second, third] = cycles.map((crop) => water.get(crop));
  return first === undefined || second === undefined || third === undefined ? undefined : Math.max(first, second, third);
}

function withinQuota(estimate: number | undefined, quota: number) {
  return estimate !== undefined && estimate <= quota + 1e-9;
}

function compareCalendarOnly(
  firstMonth: number,
  field: FieldSelection,
  water: ReturnType<typeof seasonalWaterByCrop>,
  dryWater: ReturnType<typeof seasonalWaterByCrop> | undefined,
  eligiblePlans: readonly RotationPlan[],
  selected: RotationPlan | undefined,
): CalendarBenchmark {
  const baseline = distinctSequences(CROP_PROFILES.map(({ id }) => id)).map((cycles) => ({
    cycles, schedule: scheduleSequence(cycles, firstMonth),
  })).sort((a, b) =>
    parseMonth(a.schedule[0].harvestMonth) - parseMonth(b.schedule[0].harvestMonth) ||
    parseMonth(a.schedule[2].harvestMonth) - parseMonth(b.schedule[2].harvestMonth) || compareCropSequences(a, b),
  )[0];
  const quota = field.irrigationQuotaM3PerDa;
  const baselineWater = peakSeasonWater(baseline.cycles, water);
  const baselineDryWater = dryWater ? peakSeasonWater(baseline.cycles, dryWater) : undefined;
  return {
    baseline: {
      calendar: summarizeCalendar(baseline.schedule, firstMonth),
      historicalScore: eligiblePlans.find((plan) => compareCropSequences(plan, baseline) === 0)?.score,
      meetsDeadline: !field.latestFirstHarvest || baseline.schedule[0].harvestMonth <= field.latestFirstHarvest,
      fitsQuota: quota === undefined || baselineWater === undefined ? undefined : withinQuota(baselineWater, quota),
      dryYearFitsQuota: quota === undefined || baselineDryWater === undefined ? undefined : withinQuota(baselineDryWater, quota),
      waterM3PerDa: baselineWater,
      dryYearWaterM3PerDa: baselineDryWater,
    },
    selected: selected ? {
      calendar: summarizeCalendar(selected.schedule, firstMonth),
      historicalScore: selected.score,
      waterM3PerDa: peakSeasonWater(selected.cycles, water),
      dryYearWaterM3PerDa: dryWater ? peakSeasonWater(selected.cycles, dryWater) : undefined,
    } : undefined,
  };
}

function rankByScore(plans: readonly RotationPlan[]) {
  let previousScore: number | undefined;
  let rank = 0;
  return new Map(plans.map((plan, index) => {
    if (plan.score !== previousScore) rank = index + 1;
    previousScore = plan.score;
    return [plan.cycles.join(","), { score: plan.score, rank }] as const;
  }));
}

function replayDryYear(
  stress: NonNullable<ReturnType<typeof buildHistoricalStress>>,
  dryYearPlans: RotationPlan[],
  firstMonth: number,
  historicalPlans: readonly RotationPlan[],
  strategies: readonly RotationStrategy[],
): RotationStressTest {
  const dryYear = rankByScore(dryYearPlans);
  const historical = rankByScore(historicalPlans);
  let robustPlan: RotationPlan | undefined;
  let bestFloor = -Infinity;
  for (const plan of historicalPlans) {
    const dryScore = dryYear.get(plan.cycles.join(","))?.score;
    if (dryScore === undefined) continue;
    const floor = Math.min(plan.score, dryScore);
    if (floor > bestFloor) {
      robustPlan = plan;
      bestFloor = floor;
    }
  }

  const shown = strategies.map(({ plan, priorities }) => ({ plan, priorities }));
  const extraPlan = robustPlan && !shown.some(({ plan }) => plan === robustPlan) ? robustPlan : undefined;
  if (extraPlan) shown.push({ plan: extraPlan, priorities: [] });

  return {
    year: stress.year,
    precipitationMm: stress.precipitationMm,
    medianPrecipitationMm: stress.medianPrecipitationMm,
    completeYears: stress.completeYears,
    plans: shown.map(({ plan, priorities }) => {
      const key = plan.cycles.join(",");
      const dry = dryYear.get(key);
      return {
        cycles: plan.cycles,
        priorities,
        historicalScore: plan.score,
        historicalRank: historical.get(key)!.rank,
        dryYearScore: dry?.score,
        dryYearRank: dry?.rank,
        isRobustPick: plan === robustPlan,
      };
    }),
    robustPlan: extraPlan ? { plan: extraPlan, calendar: summarizeCalendar(extraPlan.schedule, firstMonth) } : undefined,
  };
}

/** Find each priority winner before limiting the historical-fit ranking to three plans. */
export function analyzeRotations(
  climate: ClimateSummary,
  field: FieldSelection,
  firstAvailableMonth: { year: number; month: number },
): {
  rotations: RotationPlan[];
  strategies: RotationStrategy[];
  harvestDeadline?: HarvestDeadlineResult;
  rotationStressTest?: RotationStressTest;
  irrigationQuota?: IrrigationQuotaResult;
  calendarBenchmark?: CalendarBenchmark;
} {
  const firstMonth = monthIndex(firstAvailableMonth.year, firstAvailableMonth.month);
  const allPlans = enumerateRankedRotations(climate, field, firstMonth);
  const deadlinePlans = byHarvestDeadline(allPlans, field.latestFirstHarvest);
  const harvestDeadline = field.latestFirstHarvest ? {
    month: field.latestFirstHarvest,
    candidateCount: allPlans.length,
    matchingCount: deadlinePlans.length,
    earliestPossibleMonth: allPlans.map(({ schedule }) => schedule[0].harvestMonth).sort()[0],
  } : undefined;
  const quota = field.irrigationQuotaM3PerDa;
  const stress = quota !== undefined || deadlinePlans.length > 0 ? buildHistoricalStress(climate) : undefined;
  const water = quota === undefined ? undefined : seasonalWaterByCrop(climate, field);
  const dryWater = stress && water ? seasonalWaterByCrop(stress.climate, field) : undefined;
  let irrigationQuota: IrrigationQuotaResult | undefined;
  let plans = deadlinePlans;
  let selectedDryPlans = stress ? byHarvestDeadline(enumerateRankedRotations(stress.climate, field, firstMonth), field.latestFirstHarvest) : [];
  if (quota !== undefined && water) {
    const dryEligible = new Set(selectedDryPlans.map(({ cycles }) => cycles.join(",")));
    const estimates = deadlinePlans.map((plan) => {
      const historical = peakSeasonWater(plan.cycles, water);
      const dry = dryWater ? peakSeasonWater(plan.cycles, dryWater) : undefined;
      const required = historical !== undefined && (!dryWater || dry !== undefined) ? Math.max(historical, dry ?? historical) : undefined;
      return { plan, required, dry };
    });
    const assessable = estimates.filter(({ plan, required }) => required !== undefined && (!stress || dryEligible.has(plan.cycles.join(","))));
    const requiredValues = assessable.flatMap(({ required }) => required === undefined ? [] : [required]);
    plans = assessable.filter(({ required }) => withinQuota(required, quota)).map(({ plan }) => plan);
    if (dryWater) selectedDryPlans = selectedDryPlans.filter(({ cycles }) => withinQuota(peakSeasonWater(cycles, dryWater), quota));
    irrigationQuota = {
      limitM3PerDa: quota,
      candidateCount: deadlinePlans.length,
      matchingCount: plans.length,
      dryYearMatchingCount: dryWater ? estimates.filter(({ plan, dry }) => dryEligible.has(plan.cycles.join(",")) && withinQuota(dry, quota)).length : undefined,
      withoutWaterEstimateCount: estimates.filter(({ required }) => required === undefined).length,
      minimumRequiredM3PerDa: requiredValues.length ? Math.min(...requiredValues) : undefined,
    };
  }
  const calendarBenchmark = water ? compareCalendarOnly(firstMonth, field, water, dryWater, allPlans, plans[0]) : undefined;
  const constraintResults = {
    ...(harvestDeadline ? { harvestDeadline } : {}),
    ...(irrigationQuota ? { irrigationQuota, calendarBenchmark } : {}),
  };
  if (plans.length === 0) return { rotations: [], strategies: [], ...constraintResults };

  const candidates = plans.map((plan) => ({
    plan,
    firstHarvest: parseMonth(plan.schedule[0].harvestMonth),
    finalHarvest: parseMonth(plan.schedule[2].harvestMonth),
    families: countCropFamilies(plan.cycles),
  }));
  const earliest = candidates.toSorted((a, b) =>
    a.firstHarvest - b.firstHarvest || b.plan.score - a.plan.score ||
    a.finalHarvest - b.finalHarvest || compareCropSequences(a.plan, b.plan),
  )[0];
  const mostDiverse = candidates.toSorted((a, b) =>
    b.families - a.families || b.plan.score - a.plan.score ||
    a.firstHarvest - b.firstHarvest || compareCropSequences(a.plan, b.plan),
  )[0];

  const winners: [RotationPriority, RotationPlan][] = [
    ["historical-fit", plans[0]],
    ["early-harvest", earliest.plan],
    ["family-diversity", mostDiverse.plan],
  ];
  const strategies = new Map<RotationPlan, RotationStrategy>();
  for (const [priority, plan] of winners) {
    const existing = strategies.get(plan);
    if (existing) {
      existing.priorities.push(priority);
    } else {
      strategies.set(plan, { priorities: [priority], plan, calendar: summarizeCalendar(plan.schedule, firstMonth) });
    }
  }

  const selectedStrategies = [...strategies.values()];
  const rotationStressTest = stress ? replayDryYear(stress, selectedDryPlans, firstMonth, plans, selectedStrategies) : undefined;
  return {
    rotations: plans.slice(0, 3),
    strategies: selectedStrategies,
    ...constraintResults,
    ...(rotationStressTest ? { rotationStressTest } : {}),
  };
}
