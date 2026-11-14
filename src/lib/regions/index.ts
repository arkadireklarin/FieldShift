import type { Coordinates, RegionApplicability } from "../../types/api";

export interface ServiceRegion {
  id: string;
  name: string;
  /** IANA zone that sets the first planning month. */
  timeZone: string;
  /** Approximate exterior ring. Closing the ring is implicit. */
  boundary: readonly Coordinates[];
}

/**
 * Hand-drawn outline of the Central Anatolian plateau. The crop calendars and water responses
 * come from Konya and Ankara sources, so plans stop at this line.
 */
const CENTRAL_ANATOLIA: ServiceRegion = {
  id: "central-anatolia",
  name: "Central Anatolia",
  timeZone: "Europe/Istanbul",
  boundary: [
    { lat: 39.55, lon: 30.0 }, { lat: 40.05, lon: 30.2 }, { lat: 40.25, lon: 31.6 }, { lat: 40.6, lon: 32.6 },
    { lat: 41.0, lon: 33.2 }, { lat: 40.95, lon: 34.1 }, { lat: 40.3, lon: 34.3 }, { lat: 40.25, lon: 35.6 },
    { lat: 39.95, lon: 36.3 }, { lat: 40.3, lon: 37.0 }, { lat: 40.3, lon: 38.4 }, { lat: 39.4, lon: 38.8 },
    { lat: 38.6, lon: 37.5 }, { lat: 38.2, lon: 36.6 }, { lat: 37.75, lon: 35.6 }, { lat: 37.35, lon: 34.7 },
    { lat: 37.0, lon: 33.6 }, { lat: 36.95, lon: 32.8 }, { lat: 37.25, lon: 32.0 }, { lat: 37.55, lon: 31.4 },
    { lat: 38.3, lon: 31.1 }, { lat: 38.95, lon: 30.8 },
  ],
};

export const SERVICE_REGIONS: readonly ServiceRegion[] = [CENTRAL_ANATOLIA];

function contains(boundary: readonly Coordinates[], { lat, lon }: Coordinates): boolean {
  let inside = false;
  for (let index = 0, previous = boundary.length - 1; index < boundary.length; previous = index++) {
    const a = boundary[index];
    const b = boundary[previous];
    if ((a.lat > lat) !== (b.lat > lat) && lon < (b.lon - a.lon) * (lat - a.lat) / (b.lat - a.lat) + a.lon) {
      inside = !inside;
    }
  }
  return inside;
}

export function findServiceRegion(location: Coordinates): ServiceRegion | undefined {
  return SERVICE_REGIONS.find(({ boundary }) => contains(boundary, location));
}

export function describeApplicability(region: ServiceRegion | undefined): RegionApplicability {
  if (region) {
    return {
      status: "validated_region",
      region: { id: region.id, name: region.name },
      message: `This point is inside the approximate ${region.name} pilot area. Crop calendars and water responses are provisional regional estimates.`,
    };
  }
  const names = SERVICE_REGIONS.map(({ name }) => name).join(", ");
  return {
    status: "outside_validated_region",
    message: `This point is outside the approximate ${names} pilot area. NASA POWER climate history is available here. Crop scores and plans require the regional crop profiles.`,
  };
}
