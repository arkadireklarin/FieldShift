import type {
  ClimateSummary,
  CropId,
  CropSuitability,
  FieldSelection,
  RecommendResponse,
  RotationCalendar,
  RotationCycle,
  RotationSoilHealthMetrics,
  SingleSoilInputProbe,
  SoilAssessment,
  SoilCropChange,
  SoilHealthComparison,
  SoilInputStatus,
} from "../../types/api";
import { CROP_PROFILES, getCropProfile } from "../crops/profiles";
import { assessCropSuitability } from "../crops/suitability";
import {
  DEFAULT_FIELD_ROOTING_DEPTH_M,
  MAX_STORED_SOIL_WATER_MM,
  SOIL_RECHARGE_EFFICIENCY,
  SOIL_TEXTURE_WATER_MM_PER_M,
} from "../crops/water-balance";
import { analyzeRotations, type RotationPlan } from "./index";

const FAO_56_TABLE_19 = {
  title: "FAO Irrigation and Drainage Paper 56, table 19, typical soil water characteristics",
  url: "https://www.fao.org/4/x0490e/x0490e0e.htm",
};

const FAO_56_TABLE_22 = {
  title: "FAO Irrigation and Drainage Paper 56, table 22, effective rooting depths, and Konya field trials",
  url: "https://www.fao.org/4/x0490e/x0490e0e.htm",
};

const FAO_SOIL_PH = {
  title: "FAO Soils Bulletin 56 and FAO EcoCrop crop pH reference ranges",
  url: "https://www.fao.org/4/s8930e/s8930e.pdf",
};

function formatSequence(cycles: readonly [CropId, CropId, CropId] | undefined): string {
  if (!cycles) return "No eligible plan";
  return cycles.map((id) => getCropProfile(id).name).join(" → ");
}

function buildSoilInputStatuses(field: FieldSelection): SoilInputStatus[] {
  const texture = field.soilTexture;
  const depthCm = field.rootingDepthCm;
  const ph = field.measuredSoilPh;
  const soilCustomized = texture !== undefined || depthCm !== undefined;

  const textureInfo = texture ? SOIL_TEXTURE_WATER_MM_PER_M[texture] : undefined;
  const textureStatus: SoilInputStatus = textureInfo
    ? {
        id: "soilTexture",
        label: "Soil texture class",
        status: "provided",
        value: `${textureInfo.label} (${textureInfo.mmPerM} mm/m)`,
        unit: "mm/m",
        assumption: `Assumes ${textureInfo.mmPerM} mm of extractable preseason water per meter of effective root zone (within FAO-56 table 19 ${textureInfo.faoRangeMmPerM}).`,
        effect: `Sets per-meter soil water storage capacity to ${textureInfo.mmPerM} mm/m before multiplying by each crop's effective root-zone depth.`,
        source: FAO_56_TABLE_19,
      }
    : {
        id: "soilTexture",
        label: "Soil texture class",
        status: "default_assumed",
        value: `Unmeasured (default ${MAX_STORED_SOIL_WATER_MM} mm/m)`,
        unit: "mm/m",
        assumption: `Local texture was not provided. Uses ${MAX_STORED_SOIL_WATER_MM} mm/m from non-irrigated Konya chickpea and sunflower trial plots (~128 mm drawn).`,
        effect: soilCustomized
          ? `Combines ${MAX_STORED_SOIL_WATER_MM} mm/m with the entered ${depthCm} cm root-zone depth.`
          : `Uses the regional ${MAX_STORED_SOIL_WATER_MM} mm preseason storage cap for all crops.`,
        source: FAO_56_TABLE_19,
      };

  const depthStatus: SoilInputStatus = depthCm !== undefined
    ? {
        id: "rootingDepthCm",
        label: "Effective root-zone depth",
        status: "provided",
        value: `${depthCm} cm (${(depthCm / 100).toFixed(2)} m)`,
        unit: "cm",
        assumption: `Caps each crop's effective root zone at min(${(depthCm / 100).toFixed(2)} m field depth, FAO-56 table 22 crop maximum root depth).`,
        effect: `Limits preseason soil water storage to (texture mm/m) × min(${(depthCm / 100).toFixed(2)} m, crop max root depth). Shallow-rooted lentil (0.8 m max) and chickpea (1.0 m max) cap earlier than deep-rooted wheat (1.8 m max).`,
        source: FAO_56_TABLE_22,
      }
    : {
        id: "rootingDepthCm",
        label: "Effective root-zone depth",
        status: "default_assumed",
        value: `Unmeasured (default ${DEFAULT_FIELD_ROOTING_DEPTH_M * 100} cm reference)`,
        unit: "cm",
        assumption: `Field root-zone depth was not provided. Assumes a ${DEFAULT_FIELD_ROOTING_DEPTH_M.toFixed(1)} m reference soil profile without a shallower hardpan or gravel barrier.`,
        effect: soilCustomized
          ? `Applies a ${DEFAULT_FIELD_ROOTING_DEPTH_M.toFixed(1)} m field depth capped by each crop's FAO-56 maximum root depth (lentil 0.8 m, others 1.0 m).`
          : `Retains the uniform ${MAX_STORED_SOIL_WATER_MM} mm preseason storage cap across crops.`,
        source: FAO_56_TABLE_22,
      };

  const phStatus: SoilInputStatus = ph !== undefined
    ? {
        id: "measuredSoilPh",
        label: "Measured soil pH",
        status: "provided",
        value: `${ph} pH`,
        unit: "pH (H₂O)",
        assumption: "Compares laboratory water-pH against each crop's provisional FAO EcoCrop range, tapering linearly to 0 at 2.0 pH units outside the band.",
        effect: "Activates the 10% soil pH suitability factor (reducing temperature to 35%, water to 45%, and previous crop to 10%).",
        source: FAO_SOIL_PH,
      }
    : {
        id: "measuredSoilPh",
        label: "Measured soil pH",
        status: "omitted",
        value: "Not provided (factor omitted)",
        unit: "pH (H₂O)",
        assumption: "No soil pH measurement was supplied, so the pH factor is omitted rather than guessed and the remaining factors are reweighted to 100%.",
        effect: "Suitability weights become 38.9% temperature, 50.0% water balance, and 11.1% previous crop transition.",
        source: FAO_SOIL_PH,
      };

  return [textureStatus, depthStatus, phStatus];
}

function buildCropChanges(
  baselineSuitability: readonly CropSuitability[],
  currentSuitability: readonly CropSuitability[],
): SoilCropChange[] {
  const byCrop = new Map(currentSuitability.map((item) => [item.crop, item]));
  return baselineSuitability.map((base) => {
    const current = byCrop.get(base.crop) ?? base;
    return {
      crop: base.crop,
      baselineStorageCapMm: base.water?.soilStorageCapMm ?? MAX_STORED_SOIL_WATER_MM,
      currentStorageCapMm: current.water?.soilStorageCapMm ?? MAX_STORED_SOIL_WATER_MM,
      baselineStoredWaterMm: base.water?.storedSoilWaterMm,
      currentStoredWaterMm: current.water?.storedSoilWaterMm,
      baselineNetIrrigationMm: base.water?.netIrrigationRequirementMm,
      currentNetIrrigationMm: current.water?.netIrrigationRequirementMm,
      baselineRainfedYieldShare: base.water?.rainfedRelativeYield,
      currentRainfedYieldShare: current.water?.rainfedRelativeYield,
      baselineScore: base.score,
      currentScore: current.score,
      baselineFeasible: base.feasibility?.status === "feasible",
      currentFeasible: current.feasibility?.status === "feasible",
    };
  });
}

function runProbe(
  id: string,
  inputLabel: string,
  changedValue: string,
  assumptionChanged: string,
  climate: ClimateSummary,
  baselineField: FieldSelection,
  probeField: FieldSelection,
  firstAvailableMonth: { year: number; month: number },
  baselineSuitability: readonly CropSuitability[],
  baselineAnalysis: ReturnType<typeof analyzeRotations>,
): SingleSoilInputProbe {
  const previous = getCropProfile(probeField.previousCrop);
  const probeSuitability = CROP_PROFILES.map((crop) => assessCropSuitability(crop, climate, probeField, previous));
  const probeAnalysis = analyzeRotations(climate, probeField, firstAvailableMonth);

  const baseTop = baselineAnalysis.rotations[0];
  const probeTop = probeAnalysis.rotations[0];
  const planChanged = baseTop?.cycles.join(",") !== probeTop?.cycles.join(",");

  const changes = buildCropChanges(baselineSuitability, probeSuitability);
  const biggestWaterShift = [...changes]
    .filter((c) => c.baselineStoredWaterMm !== undefined && c.currentStoredWaterMm !== undefined)
    .sort((a, b) =>
      Math.abs((b.currentStoredWaterMm ?? 0) - (b.baselineStoredWaterMm ?? 0)) -
      Math.abs((a.currentStoredWaterMm ?? 0) - (a.baselineStoredWaterMm ?? 0)),
    )[0];

  const newlyExcluded = changes.filter((c) => c.baselineFeasible && !c.currentFeasible).map((c) => getCropProfile(c.crop).name);
  const scoreShifts = changes
    .filter((c) => c.baselineScore !== c.currentScore)
    .map((c) => `${getCropProfile(c.crop).name} (${c.baselineScore ?? "–"} → ${c.currentScore ?? "–"})`);

  let calculationEffect: string;
  if (biggestWaterShift && Math.abs((biggestWaterShift.currentStoredWaterMm ?? 0) - (biggestWaterShift.baselineStoredWaterMm ?? 0)) >= 0.5) {
    const cropName = getCropProfile(biggestWaterShift.crop).name;
    calculationEffect = `${cropName} preseason soil water cap moves from ${biggestWaterShift.baselineStorageCapMm.toFixed(0)} mm to ${biggestWaterShift.currentStorageCapMm.toFixed(0)} mm; mean stored soil water shifts from ${biggestWaterShift.baselineStoredWaterMm!.toFixed(1)} mm to ${biggestWaterShift.currentStoredWaterMm!.toFixed(1)} mm and net irrigation from ${biggestWaterShift.baselineNetIrrigationMm!.toFixed(1)} to ${biggestWaterShift.currentNetIrrigationMm!.toFixed(1)} m³/da.${scoreShifts.length ? ` Suitability scores shift for ${scoreShifts.join(", ")}.` : ""}`;
  } else if (scoreShifts.length > 0) {
    calculationEffect = `Suitability scores shift for ${scoreShifts.join(", ")}.`;
  } else {
    calculationEffect = "Preseason rainfall in this record stays below the adjusted soil storage cap, so crop scores remain unchanged.";
  }

  let planEffect: string;
  if (newlyExcluded.length > 0) {
    planEffect = `Excludes ${newlyExcluded.join(", ")} on rainfed water deficit. Top plan changes from ${formatSequence(baseTop?.cycles)} to ${formatSequence(probeTop?.cycles)}.`;
  } else if (
    baselineAnalysis.irrigationQuota &&
    probeAnalysis.irrigationQuota &&
    baselineAnalysis.irrigationQuota.matchingCount !== probeAnalysis.irrigationQuota.matchingCount
  ) {
    planEffect = `Rotations fitting the ${baselineAnalysis.irrigationQuota.limitM3PerDa} m³/da quota change from ${baselineAnalysis.irrigationQuota.matchingCount} to ${probeAnalysis.irrigationQuota.matchingCount}. Top plan: ${formatSequence(baseTop?.cycles)} → ${formatSequence(probeTop?.cycles)}.`;
  } else if (planChanged) {
    planEffect = `Top plan changes from ${formatSequence(baseTop?.cycles)} (${baseTop?.score ?? "–"}/100) to ${formatSequence(probeTop?.cycles)} (${probeTop?.score ?? "–"}/100).`;
  } else if (baseTop && probeTop && baseTop.score !== probeTop.score) {
    planEffect = `Top plan remains ${formatSequence(probeTop.cycles)}, with model score shifting from ${baseTop.score}/100 to ${probeTop.score}/100.`;
  } else {
    planEffect = `Top plan remains ${formatSequence(probeTop?.cycles)} (${probeTop?.score ?? "–"}/100).`;
  }

  return {
    id,
    inputLabel,
    changedValue,
    assumptionChanged,
    calculationEffect,
    planEffect,
    baselineTopPlan: baseTop?.cycles,
    baselineTopScore: baseTop?.score,
    probeTopPlan: probeTop?.cycles,
    probeTopScore: probeTop?.score,
    planChanged,
  };
}

export function buildSoilAssessment(
  climate: ClimateSummary,
  field: FieldSelection,
  firstAvailableMonth: { year: number; month: number },
  currentSuitability: readonly CropSuitability[],
  currentAnalysis: ReturnType<typeof analyzeRotations>,
): SoilAssessment {
  const baselineField: FieldSelection = {
    ...field,
    soilTexture: undefined,
    rootingDepthCm: undefined,
    measuredSoilPh: undefined,
  };
  const hasLocalSoilInputs =
    field.soilTexture !== undefined || field.rootingDepthCm !== undefined || field.measuredSoilPh !== undefined;

  const previous = getCropProfile(field.previousCrop);
  const baselineSuitability = hasLocalSoilInputs
    ? CROP_PROFILES.map((crop) => assessCropSuitability(crop, climate, baselineField, previous))
    : currentSuitability;
  const baselineAnalysis = hasLocalSoilInputs
    ? analyzeRotations(climate, baselineField, firstAvailableMonth)
    : currentAnalysis;

  const cropChanges = buildCropChanges(baselineSuitability, currentSuitability);
  const baseTop = baselineAnalysis.rotations[0];
  const currentTop = currentAnalysis.rotations[0];
  const topPlanChanged = baseTop?.cycles.join(",") !== currentTop?.cycles.join(",");

  const changedInputs: string[] = [];
  if (field.soilTexture !== undefined) changedInputs.push(`soil texture (${SOIL_TEXTURE_WATER_MM_PER_M[field.soilTexture].label})`);
  if (field.rootingDepthCm !== undefined) changedInputs.push(`root-zone depth (${field.rootingDepthCm} cm)`);
  if (field.measuredSoilPh !== undefined) changedInputs.push(`measured soil pH (${field.measuredSoilPh})`);

  let summary: string;
  if (!hasLocalSoilInputs) {
    summary = `No local soil measurements were entered. The analysis uses the default ${MAX_STORED_SOIL_WATER_MM} mm regional soil water cap and omits the pH factor. Enter a single soil input (texture, root-zone depth, or pH) or review the single-input checks below to see how local soil properties shift water storage, irrigation demand, and plan rankings.`;
  } else {
    const shiftedCrops = cropChanges.filter(
      (c) => c.baselineScore !== c.currentScore ||
        Math.abs((c.currentStoredWaterMm ?? 0) - (c.baselineStoredWaterMm ?? 0)) >= 0.1,
    );
    const quotaShift = baselineAnalysis.irrigationQuota && currentAnalysis.irrigationQuota &&
      baselineAnalysis.irrigationQuota.matchingCount !== currentAnalysis.irrigationQuota.matchingCount
      ? ` Candidate rotations fitting the ${currentAnalysis.irrigationQuota.limitM3PerDa} m³/da quota changed from ${baselineAnalysis.irrigationQuota.matchingCount} to ${currentAnalysis.irrigationQuota.matchingCount}.`
      : "";
    const planShift = topPlanChanged
      ? ` The highest-ranked plan changed from ${formatSequence(baseTop?.cycles)} (${baseTop?.score ?? "–"}/100) to ${formatSequence(currentTop?.cycles)} (${currentTop?.score ?? "–"}/100).`
      : ` The highest-ranked plan is ${formatSequence(currentTop?.cycles)} (${baseTop?.score ?? "–"} → ${currentTop?.score ?? "–"}/100).`;
    summary = `Compared with the unmeasured soil baseline, entering ${changedInputs.join(", ")} modified water storage or suitability for ${shiftedCrops.length} of ${cropChanges.length} crops.${quotaShift}${planShift}`;
  }

  const singleInputChecks: SingleSoilInputProbe[] = [
    runProbe(
      "shallow-root-zone-50cm",
      "Effective root-zone depth",
      "50 cm (shallow caliche / hardpan)",
      "Replaces the default 1.0 m (130 mm) soil profile with a 0.50 m root barrier (65 mm preseason water storage cap at 130 mm/m).",
      climate,
      baselineField,
      { ...baselineField, rootingDepthCm: 50 },
      firstAvailableMonth,
      baselineSuitability,
      baselineAnalysis,
    ),
    runProbe(
      "coarse-sandy-texture",
      "Soil texture class",
      "Coarse (90 mm/m, sandy / loamy sand)",
      "Replaces the 130 mm/m Konya loam benchmark with 90 mm/m (FAO-56 table 19 coarse texture), capping lentil (0.8 m root) at 72 mm and deeper crops at 90 mm.",
      climate,
      baselineField,
      { ...baselineField, soilTexture: "coarse" },
      firstAvailableMonth,
      baselineSuitability,
      baselineAnalysis,
    ),
    runProbe(
      "alkaline-soil-ph-8-2",
      "Measured soil pH",
      "pH 8.2 (calcareous alkaline soil)",
      "Activates the 10% measured soil pH factor against FAO EcoCrop pH bands (chickpea 6.0–8.5 stays in band; wheat 6.0–7.0 and barley/sunflower/maize/lentil up to 7.5 lose pH points).",
      climate,
      baselineField,
      { ...baselineField, measuredSoilPh: 8.2 },
      firstAvailableMonth,
      baselineSuitability,
      baselineAnalysis,
    ),
  ];

  return {
    inputs: buildSoilInputStatuses(field),
    nasaDecisionChain: {
      temperatureRole: `NASA POWER daily air temperature (T2M, ${climate.provenance.period.start} to ${climate.provenance.period.end}) is aggregated to monthly means and checked across each crop's active growth window (activeStartMonth–activeEndMonth). Crops with fewer than half of expected active seasons complete are unscored; crops outside thermal tolerance in every active month are excluded; feasible crops receive a 35% base-weight temperature score.`,
      precipitationRole: `NASA POWER daily precipitation (PRECTOTCORR) is summed to monthly totals across complete 12-month water years. Rainfall during the growing season (during) is added directly to crop supply; rainfall in the lead months before planting (before) is multiplied by ${100 * SOIL_RECHARGE_EFFICIENCY}% recharge efficiency and capped by the soil storage limit.`,
      soilInteractionRole: `Local soil texture (FAO-56 table 19 mm/m) and effective root-zone depth (cm, bounded by FAO-56 table 22 crop maximum root depth) set the preseason soil water storage cap. Spring-sown crops (lentil, chickpea, sunflower, maize) depend on winter NASA POWER precipitation stored in the soil before planting, whereas autumn-sown cereals (wheat, barley) receive winter precipitation in-season.`,
    },
    baselineComparison: {
      hasLocalSoilInputs,
      changedInputs,
      summary,
      baselineTopPlan: baseTop?.cycles,
      baselineTopScore: baseTop?.score,
      currentTopPlan: currentTop?.cycles,
      currentTopScore: currentTop?.score,
      topPlanChanged,
      baselineQuotaMatchingCount: baselineAnalysis.irrigationQuota?.matchingCount,
      currentQuotaMatchingCount: currentAnalysis.irrigationQuota?.matchingCount,
      cropChanges,
    },
    singleInputChecks,
  };
}

function summarizePlanSoilHealth(
  label: string,
  calendar: RotationCalendar,
  previousCrop: CropId,
): RotationSoilHealthMetrics {
  const sequence = calendar.schedule.map(({ crop }) => crop);
  const fallowMonths = sequence.filter((crop) => crop === "fallow").length * 12;
  const intercropGapMonths = Math.max(0, calendar.uncroppedMonths - fallowMonths);

  let lastPlantedCrop: CropId = previousCrop;
  let sameFamilyTransitions = 0;
  let sameCropTransitions = 0;
  let legumeToCerealTransitions = 0;

  for (const cycle of sequence) {
    if (cycle === "fallow") continue;
    const prevProfile = getCropProfile(lastPlantedCrop);
    const nextProfile = getCropProfile(cycle);
    if (prevProfile.id === nextProfile.id) sameCropTransitions++;
    if (prevProfile.family === nextProfile.family) sameFamilyTransitions++;
    if (prevProfile.category === "legume" && nextProfile.category === "cereal") legumeToCerealTransitions++;
    lastPlantedCrop = cycle;
  }

  const familyNote = sameFamilyTransitions === 0
    ? "No back-to-back botanical family repetition across planted cycles."
    : `Repeats the preceding botanical family in ${sameFamilyTransitions} planted transition(s)${sameCropTransitions > 0 ? ` (${sameCropTransitions} exact crop repetition)` : ""}.`;
  const uncroppedNote = fallowMonths > 0
    ? `${calendar.uncroppedMonths} months without a primary crop (${fallowMonths} months fallow, ${intercropGapMonths} months between harvest and next sowing).`
    : `${calendar.uncroppedMonths} months between harvest and next sowing with no full-year fallow.`;

  return {
    label,
    sequence,
    totalMonths: calendar.totalMonths,
    uncroppedMonths: calendar.uncroppedMonths,
    fallowMonths,
    intercropGapMonths,
    distinctCropCount: calendar.distinctCropCount,
    distinctFamilyCount: calendar.distinctFamilyCount,
    sameFamilyTransitions,
    sameCropTransitions,
    legumeToCerealTransitions,
    summary: `${familyNote} ${uncroppedNote}`,
  };
}

export function buildSoilHealthComparison(
  previousCrop: CropId,
  rotationComparison: RecommendResponse["rotationComparison"],
  rotations: readonly RotationPlan[],
  strategies: RecommendResponse["rotationStrategies"],
): SoilHealthComparison {
  const current = rotationComparison
    ? summarizePlanSoilHealth("Current rotation", rotationComparison.current, previousCrop)
    : undefined;

  const recommended: RotationSoilHealthMetrics[] = [];
  const seen = new Set<string>();

  if (rotationComparison) {
    rotationComparison.alternatives.forEach((calendar, index) => {
      const key = calendar.schedule.map(({ crop }) => crop).join(",");
      if (!seen.has(key)) {
        seen.add(key);
        recommended.push(summarizePlanSoilHealth(`Plan ${index + 1}`, calendar, previousCrop));
      }
    });
  }

  for (const strategy of strategies ?? []) {
    const key = strategy.calendar.schedule.map(({ crop }) => crop).join(",");
    if (!seen.has(key)) {
      seen.add(key);
      const rankIndex = rotations.findIndex((r) => r.cycles.join(",") === key);
      const label = rankIndex >= 0 ? `Plan ${rankIndex + 1}` : strategy.priorities.join(" · ");
      recommended.push(summarizePlanSoilHealth(label, strategy.calendar, previousCrop));
    }
  }

  return {
    previousCrop,
    current,
    recommended,
    requiredFieldEvidence: [
      {
        claim: "Ground cover and erosion protection during uncropped months",
        whyCalendarIsInsufficient: "Calendar uncropped months only measure the time between primary crop harvest and the next sowing window (or a 12-month fallow). They do not record whether stubble, volunteer growth, or a cover crop protects the soil surface.",
        requiredMeasurement: "On-field visual or quadrat ground-cover observations during the uncropped and fallow months, plus tillage and residue-removal records.",
      },
      {
        claim: "Soil organic matter (SOM) and soil carbon change",
        whyCalendarIsInsufficient: "Adding crop families or legumes in a 3-cycle schedule does not prove net organic matter accumulation, which depends on biomass return, residue grazing/baling, tillage intensity, and decomposition rate.",
        requiredMeasurement: "Baseline and multi-year repeat laboratory soil organic matter samples taken at the same soil depth, season, and analytical method across rotation cycles.",
      },
      {
        claim: "Residual nitrogen carried from legumes to cereals",
        whyCalendarIsInsufficient: "Legume-to-cereal transitions receive a relative compatibility credit, not a fixed kg N/da fertilizer deduction, because biological N fixation varies with nodulation, water stress, and whether haulms are removed.",
        requiredMeasurement: "Pre-sowing root-zone mineral nitrogen (NO₃-N / NH₄-N) soil test before the following cereal crop.",
      },
    ],
  };
}
