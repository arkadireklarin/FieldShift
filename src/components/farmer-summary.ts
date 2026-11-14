import type { CropId, RecommendResponse, RotationChange, RotationCycle, RotationSequenceMeasures } from "@/types/api";

/** Botanical families, mirroring src/data/crops.json so the summary needs no profile lookup. */
const cropFamilies: Record<CropId, string> = {
  wheat: "Poaceae", barley: "Poaceae", maize: "Poaceae",
  chickpea: "Fabaceae", lentil: "Fabaceae", sunflower: "Asteraceae",
};

export type Language = "tr" | "en";

export const languageNames: Record<Language, string> = { tr: "Türkçe", en: "English" };

const cycleNames: Record<Language, Record<RotationCycle, string>> = {
  tr: {
    wheat: "Buğday", barley: "Arpa", chickpea: "Nohut",
    lentil: "Mercimek", sunflower: "Ayçiçeği", maize: "Mısır", fallow: "Nadas",
  },
  en: {
    wheat: "Wheat", barley: "Barley", chickpea: "Chickpea",
    lentil: "Lentil", sunflower: "Sunflower", maize: "Maize", fallow: "Fallow",
  },
};

export function cycleName(cycle: RotationCycle, language: Language): string {
  return cycleNames[language][cycle];
}

/** What a grower reads first. Every line is derived from a value in the analysis. */
export interface FarmerSummary {
  /** The one thing to do, in a single line. */
  headline: string;
  /** Why the model put it first. */
  reasons: string[];
  /** The whole sequence in order, for the calendar strip. */
  sequence?: readonly RotationCycle[];
  /** What the change costs, what is uncertain, and which crops are off the table. */
  cautions: string[];
  /** A second option the grower could take instead. */
  alternative?: string;
  /** How the plan held up in the driest year on record. */
  dryYear?: string;
  /** Always shown: this is advice, not an instruction. */
  footer: string;
}

const text = {
  tr: {
    changeHeadline: (change: RotationChange) =>
      `Planınızda tek bir şeyi değiştirin: ${change.cycle}. ekimde ${cycleName(change.from, "tr").toLowerCase()} yerine ${cycleName(change.to, "tr").toLowerCase()}.`,
    planHeadline: (crop: RotationCycle) => `Gelecek sezon için güçlü seçenek: ${cycleName(crop, "tr")}`,
    noChange: "Mevcut planınız bu tarla için uygun görünüyor; değiştirmenizi gerektiren bir şey bulamadık.",
    noPlan: "Bu tarla için öneri veremiyoruz.",
    breaks: (count: number) => `Aynı ürünü ya da aynı aileyi üst üste ekmekten ${count} kez kurtarır. İç Anadolu'da 21 yıl süren bir denemede rotasyondaki buğday, üst üste ekilen buğdaydan daha çok verdi.`,
    bareMonths: (count: number) => `Tarla ${count} ay daha az boş kalır.`,
    water: (saved: number) => `En çok su isteyen sezonda dekara yaklaşık ${saved} m³ daha az sulama gerekir.`,
    infeasible: (count: number) => `Bu tarlada yetişmesini beklemediğimiz ${count} ürünü plandan çıkarır.`,
    excluded: (crops: readonly RotationCycle[]) =>
      `Bu tarlada sulama olmadan ${crops.map((crop) => cycleName(crop, "tr").toLowerCase()).join(" ve ")} önermiyoruz: yağış, su ihtiyacının yeterince azını karşılıyor.`,
    gridCell: "İklim bilgisi NASA'nın bölgesel kayıtlarından geliyor; tarlanızda ölçülmedi.",
    alternative: (change: RotationChange) =>
      `Başka seçenek: ${change.cycle}. ekimde ${cycleName(change.to, "tr").toLowerCase()}.`,
    alternativePlan: (crop: RotationCycle) => `Başka seçenek: ${cycleName(crop, "tr")} ile başlamak.`,
    familyChange: (previous: RotationCycle, next: RotationCycle) =>
      `${cycleName(previous, "tr")}dan sonra farklı bir bitki ailesi gelir. Bu, bazı hastalık ve zararlı döngülerini kırabilir.`,
    rainShare: (crop: RotationCycle, share: number) =>
      `Son yılların yağışı ${cycleName(crop, "tr").toLowerCase()} suyunun yaklaşık %${share}'ini karşıladı.`,
    dryYearHeld: (year: number) => `Yıl kurak geçerse: ${year} gibi bir yılda bu plan yine uygun kalıyor.`,
    dryYearLost: (year: number) => `Yıl kurak geçerse: ${year} gibi bir yılda bu plan zorlanıyor.`,
    footer: "Bu bir öneridir. Son kararı siz ve ziraat mühendisiniz verir.",
  },
  en: {
    changeHeadline: (change: RotationChange) =>
      `Change one thing in your plan: ${cycleName(change.to, "en").toLowerCase()} instead of ${cycleName(change.from, "en").toLowerCase()} in cycle ${change.cycle}.`,
    planHeadline: (crop: RotationCycle) => `A strong option for next season: ${cycleName(crop, "en")}`,
    noChange: "Your current plan already looks sound for this field; we found nothing that ranks above it.",
    noPlan: "We cannot offer a recommendation for this field.",
    breaks: (count: number) => `It breaks ${count} back-to-back repetition(s) of the same crop or family. In a 21-year Central Anatolia trial, wheat grown in rotation out-yielded wheat grown on itself.`,
    bareMonths: (count: number) => `The field spends ${count} fewer months without a crop.`,
    water: (saved: number) => `The thirstiest season needs about ${saved} m³ per decare less irrigation.`,
    infeasible: (count: number) => `It drops ${count} crop(s) we would not expect to grow on this field.`,
    excluded: (crops: readonly RotationCycle[]) =>
      `Without irrigation we do not recommend ${crops.map((crop) => cycleName(crop, "en").toLowerCase()).join(" or ")} here: rainfall covers too little of what they need.`,
    gridCell: "The climate record comes from NASA's regional data. It was not measured on your field.",
    alternative: (change: RotationChange) =>
      `Another option: ${cycleName(change.to, "en").toLowerCase()} in cycle ${change.cycle}.`,
    alternativePlan: (crop: RotationCycle) => `Another option: start with ${cycleName(crop, "en").toLowerCase()}.`,
    familyChange: (previous: RotationCycle, next: RotationCycle) =>
      `It follows ${cycleName(previous, "en").toLowerCase()} with a different botanical family, which can break some pest and disease cycles.`,
    rainShare: (crop: RotationCycle, share: number) =>
      `Recent rainfall covered about ${share}% of what ${cycleName(crop, "en").toLowerCase()} needs.`,
    dryYearHeld: (year: number) => `If the year turns dry: in a year like ${year} this plan still holds.`,
    dryYearLost: (year: number) => `If the year turns dry: in a year like ${year} this plan struggles.`,
    footer: "This is a suggestion. You and your agronomist make the decision.",
  },
} satisfies Record<Language, Record<string, unknown>>;

/** Written from the measured differences, not from the engine's own English sentences. */
function changeReasons(
  change: RotationChange,
  current: RotationSequenceMeasures,
  language: Language,
): string[] {
  const t = text[language];
  const reasons: string[] = [];
  const droppedCrops = current.infeasibleCycles - change.measures.infeasibleCycles;
  const brokenRepeats = current.repeatedTransitions - change.measures.repeatedTransitions;
  const savedWater = (current.peakSeasonIrrigationM3PerDa ?? 0) - (change.measures.peakSeasonIrrigationM3PerDa ?? 0);
  const filledMonths = current.uncroppedMonths - change.measures.uncroppedMonths;

  if (droppedCrops > 0) reasons.push(t.infeasible(droppedCrops));
  if (brokenRepeats > 0) reasons.push(t.breaks(brokenRepeats));
  // The engine only credits water where it weighed it, so follow its own account here.
  if (savedWater > 0 && change.gains.some((gain) => gain.includes("less irrigation"))) {
    reasons.push(t.water(Math.round(savedWater)));
  }
  if (filledMonths > 0) reasons.push(t.bareMonths(filledMonths));
  return reasons;
}

/** Build the farmer-facing summary. Returns undefined when the analysis carries no recommendation. */
export function buildFarmerSummary(
  result: Pick<RecommendResponse, "suitability" | "rotations" | "rotationStrategies" | "rotationStressTest" | "singleChange" | "applicability">,
  language: Language,
  /** The grower's last crop, used to say what a recommended first crop follows. */
  previousCrop?: CropId,
): FarmerSummary | undefined {
  if (result.applicability?.status === "outside_validated_region") return undefined;
  const t = text[language];
  const change = result.singleChange;
  const plan = result.rotationStrategies?.[0]?.plan ?? result.rotations[0];
  const excluded = result.suitability
    .filter(({ feasibility }) => feasibility?.status === "excluded")
    .map(({ crop }) => crop);

  const cautions: string[] = [];
  if (excluded.length > 0) cautions.push(t.excluded(excluded));
  cautions.push(t.gridCell);

  let headline: string;
  let reasons: string[] = [];
  let sequence: readonly RotationCycle[] | undefined;
  let alternative: string | undefined;

  if (change?.best) {
    headline = t.changeHeadline(change.best);
    reasons = changeReasons(change.best, change.current.measures, language);
    sequence = change.best.sequence;
    cautions.unshift(...change.best.tradeoffs);
    const [next] = change.alternatives;
    if (next) alternative = t.alternative(next);
  } else if (change) {
    headline = t.noChange;
    sequence = change.current.sequence;
    if (plan) alternative = t.alternativePlan(plan.cycles[0]);
  } else if (plan) {
    const [first] = plan.cycles;
    headline = t.planHeadline(first);
    sequence = plan.cycles;
    if (previousCrop && cropFamilies[previousCrop] !== cropFamilies[first]) {
      reasons.push(t.familyChange(previousCrop, first));
    }
    const water = result.suitability.find(({ crop }) => crop === first)?.water;
    if (water) reasons.push(t.rainShare(first, Math.round(100 * water.rainfedSupplyShare)));
    const second = result.rotations[1];
    if (second && second.cycles[0] !== plan.cycles[0]) alternative = t.alternativePlan(second.cycles[0]);
  } else {
    headline = t.noPlan;
  }

  const stress = result.rotationStressTest;
  const stressed = sequence && stress?.plans.find(({ cycles }) => cycles.join(",") === sequence.join(","));
  const dryYear = stress && stressed
    ? (stressed.dryYearScore === undefined ? t.dryYearLost(stress.year) : t.dryYearHeld(stress.year))
    : undefined;

  return { headline, reasons, sequence, cautions, alternative, dryYear, footer: t.footer };
}
