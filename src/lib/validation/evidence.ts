import snapshot from "../../data/validation/konya-nasa-power-2021-2025.json";
import type { CropId, EvidenceCheck, ModelEvidence } from "../../types/api";
import { getCropProfile } from "../crops/profiles";
import { assessCropTransition } from "../crops/suitability";
import { assessWaterBalance, MIN_RAINFED_RELATIVE_YIELD, relativeYield } from "../crops/water-balance";

const CHICKPEA_TRIAL = {
  title: "Tarı and Bahçeci (2022), chickpea sowing time and irrigation trial on the Konya Plain, tables 4, 7 and 8",
  url: "https://doi.org/10.15316/SJAFS.2022.020",
};
const SUNFLOWER_TRIAL = {
  title: "Gündüz et al. (2018), sunflower irrigation trial in Konya, tables 4 and 5",
  url: "https://dergipark.org.tr/tr/download/article-file/595097",
};
const ROTATION_TRIAL = {
  title: "Cayci et al. (2009), rainfed wheat rotations in Central Anatolia after 21 years",
  url: "https://doi.org/10.1016/j.still.2008.09.004",
};

/** Published field outcomes. Yields and water amounts are two-year means from the cited tables. */
const OBSERVED = {
  chickpea: {
    rainfedWaterUseMm: 241,
    rainfedYieldTHa: 0.98,
    irrigatedYieldTHa: 2.03,
    fullIrrigationMm: 333,
  },
  sunflower: {
    controlWaterUseMm: 329,
    controlIrrigationMm: 94,
    fullWaterUseMm: 648,
    controlYieldKgDa: 239,
    irrigatedYieldKgDa: 453,
    fullIrrigationMm: 447,
  },
  wheatKgHa: { rotationLow: 1320, rotationHigh: 2243, continuous: 543 },
};

const WATER_TOLERANCE = 0.2;
const YIELD_TOLERANCE = 0.1;

const mm = (value: number) => `${Math.round(value)} mm`;
const percent = (share: number) => `${Math.round(100 * share)}%`;
const within = (predicted: number, observed: number) => Math.abs(predicted - observed) <= WATER_TOLERANCE * observed;

function balanceAtReferenceSite(crop: CropId) {
  const { balance } = assessWaterBalance(getCropProfile(crop), snapshot);
  if (!balance) throw new Error(`The Konya reference record has no complete water year for ${crop}.`);
  return balance;
}

function buildChecks(): EvidenceCheck[] {
  const chickpea = balanceAtReferenceSite("chickpea");
  const sunflower = balanceAtReferenceSite("sunflower");
  const wheat = balanceAtReferenceSite("wheat");

  const chickpeaUse = chickpea.seasonRainfallMm + chickpea.storedSoilWaterMm;
  const sunflowerUse = sunflower.seasonRainfallMm + sunflower.storedSoilWaterMm;
  const chickpeaYield = OBSERVED.chickpea.rainfedYieldTHa / OBSERVED.chickpea.irrigatedYieldTHa;
  const sunflowerYield = OBSERVED.sunflower.controlYieldKgDa / OBSERVED.sunflower.irrigatedYieldKgDa;
  const sunflowerRainOnlyUse = OBSERVED.sunflower.controlWaterUseMm - OBSERVED.sunflower.controlIrrigationMm;
  const sunflowerControlYield = relativeYield(
    getCropProfile("sunflower").yieldResponseKy.value,
    OBSERVED.sunflower.controlWaterUseMm / OBSERVED.sunflower.fullWaterUseMm,
  );
  const intoWheat = (previous: CropId) => assessCropTransition(getCropProfile(previous), getCropProfile("wheat")).score;
  const afterWheat = intoWheat("wheat");
  const afterOthers = (["chickpea", "lentil", "sunflower"] as const).map((crop) => ({ crop, score: intoWheat(crop) }));

  return [
    {
      id: "chickpea-rainfed-water-use",
      kind: "calibration",
      claim: "Seasonal water use of chickpea without irrigation",
      observed: `${mm(OBSERVED.chickpea.rainfedWaterUseMm)} in non-irrigated plots`,
      predicted: `${mm(chickpeaUse)} from rainfall and stored soil water`,
      agrees: within(chickpeaUse, OBSERVED.chickpea.rainfedWaterUseMm),
      source: CHICKPEA_TRIAL,
    },
    {
      id: "chickpea-rainfed-yield",
      kind: "calibration",
      claim: "Chickpea yield without irrigation as a share of the fully irrigated yield",
      observed: `${percent(chickpeaYield)} (${OBSERVED.chickpea.rainfedYieldTHa} against ${OBSERVED.chickpea.irrigatedYieldTHa} t/ha)`,
      predicted: percent(chickpea.rainfedRelativeYield),
      agrees: Math.abs(chickpea.rainfedRelativeYield - chickpeaYield) <= YIELD_TOLERANCE,
      source: CHICKPEA_TRIAL,
    },
    {
      id: "chickpea-irrigation-need",
      kind: "calibration",
      claim: "Irrigation that brings chickpea to full water use",
      observed: `${mm(OBSERVED.chickpea.fullIrrigationMm)} applied to fully irrigated plots`,
      predicted: mm(chickpea.netIrrigationRequirementMm),
      agrees: within(chickpea.netIrrigationRequirementMm, OBSERVED.chickpea.fullIrrigationMm),
      source: CHICKPEA_TRIAL,
    },
    {
      id: "sunflower-rainfed-water-use",
      kind: "calibration",
      claim: "Seasonal water use of sunflower from rainfall and soil water",
      observed: `${mm(sunflowerRainOnlyUse)}: control plots used ${mm(OBSERVED.sunflower.controlWaterUseMm)}, including ${mm(OBSERVED.sunflower.controlIrrigationMm)} of establishment irrigation`,
      predicted: mm(sunflowerUse),
      agrees: within(sunflowerUse, sunflowerRainOnlyUse),
      source: SUNFLOWER_TRIAL,
    },
    {
      id: "sunflower-control-yield",
      kind: "calibration",
      claim: "Sunflower yield of the control plots as a share of the fully irrigated yield, at their measured water use",
      observed: `${percent(sunflowerYield)} (${OBSERVED.sunflower.controlYieldKgDa} against ${OBSERVED.sunflower.irrigatedYieldKgDa} kg/da)`,
      predicted: percent(sunflowerControlYield),
      agrees: Math.abs(sunflowerControlYield - sunflowerYield) <= YIELD_TOLERANCE,
      source: SUNFLOWER_TRIAL,
    },
    {
      id: "sunflower-irrigation-need",
      kind: "calibration",
      claim: "Irrigation that brings sunflower to full water use",
      observed: `${mm(OBSERVED.sunflower.fullIrrigationMm)} applied to fully irrigated plots`,
      predicted: mm(sunflower.netIrrigationRequirementMm),
      agrees: within(sunflower.netIrrigationRequirementMm, OBSERVED.sunflower.fullIrrigationMm),
      source: SUNFLOWER_TRIAL,
    },
    {
      id: "rainfed-wheat-feasible",
      kind: "consistency",
      claim: "Wheat stays in rainfed plans",
      observed: `Rainfed wheat in rotation yielded ${OBSERVED.wheatKgHa.rotationLow}–${OBSERVED.wheatKgHa.rotationHigh} kg/ha`,
      predicted: `${percent(wheat.rainfedRelativeYield)} of water-unlimited yield, above the ${percent(MIN_RAINFED_RELATIVE_YIELD)} cutoff`,
      agrees: wheat.rainfedRelativeYield >= MIN_RAINFED_RELATIVE_YIELD,
      source: ROTATION_TRIAL,
    },
    {
      id: "wheat-after-rotation-crop",
      kind: "consistency",
      claim: "Wheat does better after another crop than after wheat",
      observed: `${OBSERVED.wheatKgHa.rotationLow}–${OBSERVED.wheatKgHa.rotationHigh} kg/ha after rotation crops or fallow against ${OBSERVED.wheatKgHa.continuous} kg/ha in continuous wheat`,
      predicted: `Transition score into wheat: ${afterOthers.map(({ crop, score }) => `${score} after ${crop}`).join(", ")}, ${afterWheat} after wheat`,
      agrees: afterOthers.every(({ score }) => score > afterWheat),
      source: ROTATION_TRIAL,
    },
  ];
}

let cached: ModelEvidence | undefined;

/** Compare the current model with published field outcomes at the Konya reference site. */
export function getModelEvidence(): ModelEvidence {
  cached ??= {
    site: `Konya, NASA POWER ${snapshot.provenance.period.start.slice(0, 4)}–${snapshot.provenance.period.end.slice(0, 4)}. The trials ran in other years, so each comparison is between climate averages.`,
    checks: buildChecks(),
    pending: "No on-farm comparison of the ranked plans with growers' own rotations has been run. Until the pilot measures yield, water and margin, the ranking is a screening aid.",
  };
  return cached;
}
