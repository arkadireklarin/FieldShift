import { CROP_PROFILES, getCropProfile } from "../../../lib/crops/profiles";
import { assessCropSuitability } from "../../../lib/crops/suitability";
import { getClimate } from "../../../lib/nasa";
import { rankRotations } from "../../../lib/rotation";
import type { RecommendResponse } from "../../../types/api";
import { climateUnavailable, invalidInput, readFieldSelection } from "../validation";

const regionalCalendar = new Intl.DateTimeFormat("en", {
  timeZone: "Europe/Istanbul",
  calendar: "gregory",
  year: "numeric",
  month: "numeric",
});

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
    const previousCrop = getCropProfile(field.previousCrop);
    const suitability = CROP_PROFILES.map((crop) => assessCropSuitability(crop, climate, field, previousCrop));
    const currentMonth = regionalCalendar.formatToParts(new Date());
    const year = Number(currentMonth.find(({ type }) => type === "year")?.value);
    const month = Number(currentMonth.find(({ type }) => type === "month")?.value);
    const nextMonth = new Date(Date.UTC(year, month, 1));
    const rotations = rankRotations(climate, field, {
      year: nextMonth.getUTCFullYear(),
      month: nextMonth.getUTCMonth() + 1,
    });
    const calendarScope = "Crop profiles use provisional Central Anatolia main-season calendars. Confirm local cultivar and planting dates before applying these rankings.";
    const limitations = [
      ...climate.limitations,
      calendarScope,
      "Scores summarize historical conditions and crop profile assumptions for relative comparison.",
    ];
    if (rotations.length === 0) {
      limitations.push("A rotation requires at least three distinct crops that meet the seasonal climate and calendar criteria.");
    }

    return Response.json({
      climate,
      suitability,
      rotations,
      provenance: [climate.provenance, { kind: "assumption", description: calendarScope }],
      limitations,
    } satisfies RecommendResponse);
  } catch (error) {
    return climateUnavailable(error);
  }
}
