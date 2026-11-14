import type { CropId, CropProfile } from "../../types/api";
import data from "../../data/crops.json";

interface Range {
  min: number;
  max: number;
}

export interface AgronomicCropProfile extends CropProfile {
  category: "cereal" | "legume" | "oilseed";
  calendar: {
    /** Inclusive month numbers, 1–12. An end before a start crosses New Year. */
    plantingStartMonth: number;
    plantingEndMonth: number;
    /** Approximate field occupancy, from earliest planting through harvest. */
    growingStartMonth: number;
    growingEndMonth: number;
    /** Active growth window for applying the air-temperature reference band. */
    activeStartMonth: number;
    activeEndMonth: number;
  };
  /** Provisional preferred air-temperature band for screening during active growth. */
  temperatureC: Range;
  /** Approximate seasonal crop water use in mm, including sources other than rain. The upper value is use without water stress. */
  waterRequirementMm: Range;
  /** Provisional preferred pH band, when supported by a reference. */
  soilPh: Range | null;
  /** Relative response to water deficits assumed in the demo's regional context. */
  irrigationSensitivity: "low" | "medium" | "high";
  /**
   * Seasonal yield response factor Ky from FAO-33. A value above 1 means yield falls faster than water use.
   * Analog values borrow the closest listed crop.
   */
  yieldResponseKy: { value: number; basis: "regional_trial" | "reference" | "analog"; source: string };
  /** Maximum effective rooting depth range in meters from FAO-56, table 22. */
  rootingDepthM: Range;
  rootCharacteristics: string | null;
  /** Confidence in using these references for regional screening. */
  dataConfidence: "low" | "moderate";
  limitations: readonly string[];
}

type CropCatalog = { [Id in CropId]: AgronomicCropProfile & { id: Id } };

const catalog = data as CropCatalog;

export const CROP_PROFILES: readonly AgronomicCropProfile[] = Object.values(catalog);

export function getCropProfile(id: CropId): AgronomicCropProfile {
  return catalog[id];
}
