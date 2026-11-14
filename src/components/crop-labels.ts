import type { CropId, RotationCycle } from "@/types/api";

export const cropLabels: Record<CropId, string> = {
  wheat: "Wheat",
  barley: "Barley",
  chickpea: "Chickpea",
  lentil: "Lentil",
  sunflower: "Sunflower",
  maize: "Maize",
};

export const rotationCycleLabels: Record<RotationCycle, string> = {
  ...cropLabels,
  fallow: "Fallow",
};
