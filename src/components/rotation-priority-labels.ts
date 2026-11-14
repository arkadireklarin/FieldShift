import type { RotationPriority } from "@/types/api";

export const rotationPriorityLabels = {
  "historical-fit": "Highest model score",
  "early-harvest": "Earliest first harvest",
  "family-diversity": "Most crop families",
} satisfies Record<RotationPriority, string>;
