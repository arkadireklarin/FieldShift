import { getClimate, isCoordinates } from "../../../lib/nasa";
import { climateUnavailable, invalidInput } from "../validation";

function readCoordinate(values: string[]): number {
  const value = values[0]?.trim();
  if (values.length !== 1 || !value || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
    return Number.NaN;
  }
  return Number(value);
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const location = { lat: readCoordinate(params.getAll("lat")), lon: readCoordinate(params.getAll("lon")) };
  if (!isCoordinates(location)) {
    return invalidInput("Provide one numeric lat (-90 to 90) and one numeric lon (-180 to 180) query parameter.");
  }

  try {
    return Response.json(await getClimate(location));
  } catch (error) {
    return climateUnavailable(error);
  }
}
