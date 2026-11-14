export type CropId = "wheat" | "barley" | "chickpea" | "lentil" | "sunflower" | "maize";
export type RotationCycle = CropId | "fallow";
export type RotationSequence = readonly [RotationCycle, RotationCycle, RotationCycle];

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface FieldSelection {
  location: Coordinates;
  /** Optional exterior ring. The selected location remains the climate query point. */
  polygon?: Coordinates[];
  previousCrop: CropId;
  irrigation: "available" | "unavailable";
  /** Net irrigation quota for each modeled cropping season, in m³ per decare. */
  irrigationQuotaM3PerDa?: number;
  /** Omit when no field measurement is available. */
  measuredSoilPh?: number;
  /** Optional three-cycle continuation of the current practice, in order. */
  currentRotation?: RotationSequence;
  /** Inclusive latest month for the first modeled harvest, formatted YYYY-MM. */
  latestFirstHarvest?: string;
}

export interface DateRange {
  /** Inclusive ISO calendar dates (YYYY-MM-DD). */
  start: string;
  end: string;
}

interface NasaPowerSource {
  source: "NASA POWER";
  sourceUrl: string;
  requestedLocation: Coordinates;
  period: DateRange;
  spatialScope: "grid_cell";
  parameters: readonly ["T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR"];
}

export type DataProvenance =
  | (NasaPowerSource & { kind: "nasa_power"; retrievedAt: string })
  | (NasaPowerSource & { kind: "cached_nasa_power"; retrievedAt: string; cachedAt: string })
  | (NasaPowerSource & { kind: "unavailable"; reason: string })
  | { kind: "assumption"; description: string };

export interface ClimateMonth {
  /** Calendar month formatted YYYY-MM. */
  month: string;
  /** Null when coverage is insufficient. */
  meanTemperatureC: number | null;
  /** Null when coverage is insufficient. A true zero is valid. */
  totalPrecipitationMm: number | null;
  expectedDays: number;
  temperatureDays: number;
  precipitationDays: number;
}

export interface ClimateSummary {
  months: ClimateMonth[];
  provenance: Extract<DataProvenance, { kind: "nasa_power" | "cached_nasa_power" }>;
  limitations: string[];
}

export interface CropProfile {
  id: CropId;
  name: string;
  family: string;
  validationStatus: "provisional";
  references: ReadonlyArray<{ title: string; url: string }>;
}

export interface CropFeasibility {
  /** Rotation plans use feasible crops only. */
  status: "feasible" | "excluded" | "unscored";
  /** Why the crop is excluded or unscored. Empty when feasible. */
  reasons: ReadonlyArray<{
    code: "WATER_DEFICIT_WITHOUT_IRRIGATION" | "TEMPERATURE_OUTSIDE_MODEL_RANGE" | "INSUFFICIENT_CLIMATE_EVIDENCE";
    message: string;
  }>;
}

/** Seasonal means across the complete water years in the climate record. 1 mm on 1 da is 1 m³. */
export interface CropWaterBalance {
  seasons: number;
  seasonRainfallMm: number;
  /** Soil water carried into the season from the months before planting. */
  storedSoilWaterMm: number;
  /** Seasonal crop water use without water stress. */
  fullWaterNeedMm: number;
  /** Share of the full water need met by rainfall and stored soil water, from 0 to 1. */
  rainfedSupplyShare: number;
  /** Expected share of the water-unlimited yield without irrigation, from 0 to 1. */
  rainfedRelativeYield: number;
  /** Irrigation needed at the root zone to meet the full water need. */
  netIrrigationRequirementMm: number;
}

export interface CropSuitability {
  crop: CropId;
  /** Relative heuristic score from 0 to 100. Null when evidence is insufficient. */
  score: number | null;
  feasibility?: CropFeasibility;
  /** Present when at least one complete water year is available. */
  water?: CropWaterBalance;
  factors: ReadonlyArray<{ label: string; scoreDelta: number; explanation: string }>;
  limitations: string[];
}

export interface RotationRecommendation {
  /** Cycles in order, starting with the next primary crop. */
  cycles: readonly [CropId, CropId, CropId];
  /** Relative heuristic score from 0 to 100. */
  score: number;
  explanations: string[];
  limitations: string[];
}

export interface RotationCalendar {
  schedule: readonly {
    crop: RotationCycle;
    /** Inclusive YYYY-MM periods. For fallow these are the start and end of the fallow period. */
    plantingMonth: string;
    harvestMonth: string;
  }[];
  /** From the first planning month through the end of the third cycle, inclusive. */
  totalMonths: number;
  /** Includes waiting between planting windows and explicit fallow periods. */
  uncroppedMonths: number;
  distinctCropCount: number;
  distinctFamilyCount: number;
}

export type RotationPriority = "historical-fit" | "early-harvest" | "family-diversity";

export interface RotationStrategy {
  /** A winning sequence can satisfy more than one search priority. */
  priorities: RotationPriority[];
  plan: RotationRecommendation;
  calendar: RotationCalendar;
}

export interface HarvestDeadlineResult {
  month: string;
  /** Eligible rotations whose first modeled harvest is in or before the deadline month. */
  matchingCount: number;
  /** Eligible rotations before applying the first-harvest deadline. */
  candidateCount: number;
  earliestPossibleMonth?: string;
}

export interface IrrigationQuotaResult {
  limitM3PerDa: number;
  /** Eligible rotations after any first-harvest deadline and before the quota. */
  candidateCount: number;
  matchingCount: number;
  dryYearMatchingCount?: number;
  withoutWaterEstimateCount: number;
  minimumRequiredM3PerDa?: number;
}

export interface CalendarBenchmark {
  baseline: {
    calendar: RotationCalendar;
    historicalScore?: number;
    meetsDeadline: boolean;
    fitsQuota?: boolean;
    dryYearFitsQuota?: boolean;
    waterM3PerDa?: number;
    dryYearWaterM3PerDa?: number;
  };
  selected?: {
    calendar: RotationCalendar;
    historicalScore?: number;
    waterM3PerDa?: number;
    dryYearWaterM3PerDa?: number;
  };
}

export interface RotationStressTest {
  year: number;
  precipitationMm: number;
  medianPrecipitationMm: number;
  completeYears: number;
  plans: Array<{
    cycles: RotationRecommendation["cycles"];
    priorities: RotationPriority[];
    historicalScore: number;
    historicalRank: number;
    dryYearScore?: number;
    dryYearRank?: number;
    isRobustPick?: boolean;
  }>;
  /** Present when the best worst-case score belongs to a different sequence than any priority winner. */
  robustPlan?: { plan: RotationRecommendation; calendar: RotationCalendar };
}

export interface RegionApplicability {
  status: "validated_region" | "outside_validated_region";
  region?: { id: string; name: string };
  message: string;
}

export interface EvidenceCheck {
  id: string;
  /** Calibration checks reuse the trials that set a parameter. Consistency checks use separate outcomes. */
  kind: "calibration" | "consistency";
  claim: string;
  observed: string;
  predicted: string;
  agrees: boolean;
  source: { title: string; url: string };
}

/** Model output compared with published field outcomes at a fixed reference site. */
export interface ModelEvidence {
  site: string;
  checks: EvidenceCheck[];
  /** Validation that still needs field data. */
  pending: string;
}

export type RecommendRequest = FieldSelection;

export interface RecommendResponse {
  /** The climate snapshot used to score suitability and rank rotations. */
  climate: ClimateSummary;
  /** Scores and plans are returned only inside the modeled pilot region. */
  applicability?: RegionApplicability;
  /** Empty outside the modeled pilot region. */
  suitability: CropSuitability[];
  /** Highest-ranked first, up to three distinct plans. */
  rotations: RotationRecommendation[];
  /** Present when a current rotation was provided. Alternatives follow the order of rotations. */
  rotationComparison?: { current: RotationCalendar; alternatives: RotationCalendar[] };
  /** Winning sequences for each priority across all eligible rotations. */
  rotationStrategies?: RotationStrategy[];
  /** Present when a latest first-harvest month was provided. */
  harvestDeadline?: HarvestDeadlineResult;
  /** Present when an irrigation quota was provided for the modeled pilot region. */
  irrigationQuota?: IrrigationQuotaResult;
  /** Calendar-only reference compared with a constraint-filtered plan when a quota was provided. */
  calendarBenchmark?: CalendarBenchmark;
  /** A historical dry-year sensitivity check for the winning strategies, when supported by the record. */
  rotationStressTest?: RotationStressTest;
  /** Published field outcomes compared with the model at a fixed reference site in the pilot region. */
  modelEvidence?: ModelEvidence;
  provenance: DataProvenance[];
  limitations: string[];
}

export interface ApiError {
  error: {
    code: "NOT_IMPLEMENTED" | "INVALID_INPUT" | "CLIMATE_UNAVAILABLE";
    message: string;
    provenance?: Extract<DataProvenance, { kind: "unavailable" }>;
  };
}

export type ClimateApiResponse = ClimateSummary | ApiError;
export type RecommendApiResponse = RecommendResponse | ApiError;
