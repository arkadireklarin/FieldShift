export type CropId = "wheat" | "barley" | "chickpea" | "lentil" | "sunflower" | "maize";

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
  /** Omit when no field measurement is available. */
  measuredSoilPh?: number;
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

export interface CropSuitability {
  crop: CropId;
  /** Relative heuristic score from 0 to 100. Null when evidence is insufficient. */
  score: number | null;
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

export type RecommendRequest = FieldSelection;

export interface RecommendResponse {
  /** The climate snapshot used to score suitability and rank rotations. */
  climate: ClimateSummary;
  suitability: CropSuitability[];
  /** Highest-ranked first, up to three distinct plans. */
  rotations: RotationRecommendation[];
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
