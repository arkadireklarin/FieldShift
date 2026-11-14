import { CROP_PROFILES, getCropProfile } from "../../../lib/crops/profiles";
import { assessCropSuitability } from "../../../lib/crops/suitability";
import { getClimate } from "../../../lib/nasa";
import { describeApplicability, findServiceRegion } from "../../../lib/regions";
import { analyzeRotations, compareRotationCalendars } from "../../../lib/rotation";
import { getModelEvidence } from "../../../lib/validation/evidence";
import type { RecommendResponse } from "../../../types/api";
import { climateUnavailable, invalidInput, readFieldSelection } from "../validation";

export async function POST(request: Request): Promise<Response> {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return invalidInput("Send a valid JSON request body.");
  }
  const field = readFieldSelection(input);
  if (typeof field === "string") return invalidInput(field);

  try {
    const climate = await getClimate(field.location);
    const region = findServiceRegion(field.location);
    const applicability = describeApplicability(region);
    if (!region) {
      return Response.json({
        climate,
        applicability,
        suitability: [],
        rotations: [],
        rotationStrategies: [],
        provenance: [climate.provenance],
        limitations: [...climate.limitations, applicability.message],
      } satisfies RecommendResponse);
    }

    const previousCrop = getCropProfile(field.previousCrop);
    const suitability = CROP_PROFILES.map((crop) => assessCropSuitability(crop, climate, field, previousCrop));
    const regionalCalendar = new Intl.DateTimeFormat("en", {
      timeZone: region.timeZone,
      calendar: "gregory",
      year: "numeric",
      month: "numeric",
    });
    const currentMonth = regionalCalendar.formatToParts(new Date());
    const year = Number(currentMonth.find(({ type }) => type === "year")?.value);
    const month = Number(currentMonth.find(({ type }) => type === "month")?.value);
    const nextMonth = new Date(Date.UTC(year, month, 1));
    const firstAvailableMonth = {
      year: nextMonth.getUTCFullYear(),
      month: nextMonth.getUTCMonth() + 1,
    };
    const { rotations, strategies, harvestDeadline, irrigationQuota, calendarBenchmark, rotationStressTest } =
      analyzeRotations(climate, field, firstAvailableMonth);
    const rotationComparison = field.currentRotation === undefined
      ? undefined
      : compareRotationCalendars(field.currentRotation, rotations, firstAvailableMonth);
    const calendarScope = `Crop profiles use provisional main-season calendars for ${region.name}. Confirm local cultivar and planting dates before applying these rankings.`;
    const limitations = [
      ...climate.limitations,
      calendarScope,
      "Scores summarize historical conditions and crop profile assumptions for relative comparison.",
    ];
    if (irrigationQuota && irrigationQuota.candidateCount > 0 && irrigationQuota.matchingCount === 0) {
      limitations.push(`No eligible rotation with a modeled net irrigation estimate fits the ${irrigationQuota.limitM3PerDa} m³ per decare quota.`);
    } else if (harvestDeadline && harvestDeadline.candidateCount > 0 && harvestDeadline.matchingCount === 0) {
      limitations.push(`No eligible rotation has a first modeled harvest by ${harvestDeadline.month}.`);
    } else if (rotations.length === 0) {
      limitations.push("A rotation requires at least three distinct crops that meet the seasonal climate and calendar criteria.");
    }

    return Response.json({
      climate,
      applicability,
      suitability,
      rotations,
      rotationComparison,
      rotationStrategies: strategies,
      harvestDeadline,
      irrigationQuota,
      calendarBenchmark,
      rotationStressTest,
      modelEvidence: getModelEvidence(),
      provenance: [climate.provenance, { kind: "assumption", description: calendarScope }],
      limitations,
    } satisfies RecommendResponse);
  } catch (error) {
    return climateUnavailable(error);
  }
}
