import type { ClimateMonth, ClimateSummary, DateRange } from "../../types/api";

export const PARAMETERS = ["T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR"] as const;
type Parameter = (typeof PARAMETERS)[number];

const FIRST_YEAR = 2021;
const LAST_YEAR = 2025;
export const PERIOD: DateRange = { start: `${FIRST_YEAR}-01-01`, end: `${LAST_YEAR}-12-31` };

interface ClimateMonthDetails extends ClimateMonth {
  meanDailyMaximumTemperatureC: number | null;
  meanDailyMinimumTemperatureC: number | null;
  highestDailyMaximumTemperatureC: number | null;
  lowestDailyMinimumTemperatureC: number | null;
  maximumTemperatureDays: number;
  minimumTemperatureDays: number;
}

export type ClimateYear = Omit<ClimateMonthDetails, "month"> & { year: number };

export interface ClimateData extends ClimateSummary {
  months: ClimateMonthDetails[];
  years: ClimateYear[];
  units: {
    source: Record<Parameter, string>;
    temperature: "°C";
    precipitationTotal: "mm";
  };
}

export class InvalidNasaResponse extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parameterMap<T>(getValue: (parameter: Parameter) => T): Record<Parameter, T> {
  return {
    T2M: getValue("T2M"),
    T2M_MAX: getValue("T2M_MAX"),
    T2M_MIN: getValue("T2M_MIN"),
    PRECTOTCORR: getValue("PRECTOTCORR"),
  };
}

function parseDailyData(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.header) || !isRecord(payload.properties) ||
      !isRecord(payload.properties.parameter) || !isRecord(payload.parameters)) {
    throw new InvalidNasaResponse("NASA POWER returned an unexpected daily data format.");
  }

  const { header, parameters } = payload;
  const observations = payload.properties.parameter;
  if (header.time_standard !== "UTC" || header.start !== PERIOD.start.replaceAll("-", "") ||
      header.end !== PERIOD.end.replaceAll("-", "")) {
    throw new InvalidNasaResponse("NASA POWER returned a different date range or time standard than requested.");
  }

  const source = parameterMap((parameter) => {
    const metadata = parameters[parameter];
    const units = isRecord(metadata) ? metadata.units : undefined;
    const expectedUnits = parameter === "PRECTOTCORR" ? ["mm/day"] : ["C", "°C"];
    if (typeof units !== "string" || !expectedUnits.includes(units)) {
      throw new InvalidNasaResponse(`NASA POWER returned missing or unexpected units for ${parameter}.`);
    }
    return units;
  });

  const series = parameterMap((parameter) => {
    const daily = observations[parameter];
    if (daily === undefined || daily === null) return {};
    if (!isRecord(daily)) {
      throw new InvalidNasaResponse(`NASA POWER returned an invalid daily series for ${parameter}.`);
    }
    return daily;
  });

  return { source, series, fillValue: header.fill_value };
}

type DailyData = ReturnType<typeof parseDailyData>;

function readObservation({ series, fillValue }: DailyData, parameter: Parameter, day: string) {
  const value = series[parameter][day];
  if (typeof value !== "number" || !Number.isFinite(value) || value === fillValue || value === -999) {
    return null;
  }
  if (parameter === "PRECTOTCORR" ? value < 0 : value < -273.15) return null;
  return value;
}

function emptyTotals() {
  return parameterMap(() => ({ sum: 0, days: 0, lowest: Infinity, highest: -Infinity }));
}

function summarizePeriod(totals: ReturnType<typeof emptyTotals>, expectedDays: number) {
  const mean = (parameter: Parameter) => {
    const { sum, days } = totals[parameter];
    return days === expectedDays ? sum / days : null;
  };

  return {
    meanTemperatureC: mean("T2M"),
    meanDailyMaximumTemperatureC: mean("T2M_MAX"),
    meanDailyMinimumTemperatureC: mean("T2M_MIN"),
    highestDailyMaximumTemperatureC: totals.T2M_MAX.days === expectedDays ? totals.T2M_MAX.highest : null,
    lowestDailyMinimumTemperatureC: totals.T2M_MIN.days === expectedDays ? totals.T2M_MIN.lowest : null,
    totalPrecipitationMm: totals.PRECTOTCORR.days === expectedDays ? totals.PRECTOTCORR.sum : null,
    expectedDays,
    temperatureDays: totals.T2M.days,
    maximumTemperatureDays: totals.T2M_MAX.days,
    minimumTemperatureDays: totals.T2M_MIN.days,
    precipitationDays: totals.PRECTOTCORR.days,
  };
}

export function aggregateClimate(payload: unknown): Pick<ClimateData, "months" | "years" | "units"> {
  const daily = parseDailyData(payload);
  const months: ClimateMonthDetails[] = [];
  const years: ClimateYear[] = [];

  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    const annualTotals = emptyTotals();
    let yearDays = 0;
    for (let month = 1; month <= 12; month++) {
      const monthTotals = emptyTotals();
      const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const monthNumber = String(month).padStart(2, "0");
      for (let day = 1; day <= monthDays; day++) {
        const date = `${year}${monthNumber}${String(day).padStart(2, "0")}`;
        for (const parameter of PARAMETERS) {
          const observation = readObservation(daily, parameter, date);
          if (observation !== null) {
            const metric = monthTotals[parameter];
            metric.sum += observation;
            metric.days++;
            metric.lowest = Math.min(metric.lowest, observation);
            metric.highest = Math.max(metric.highest, observation);
          }
        }
      }
      for (const parameter of PARAMETERS) {
        const annualMetric = annualTotals[parameter];
        const monthlyMetric = monthTotals[parameter];
        annualMetric.sum += monthlyMetric.sum;
        annualMetric.days += monthlyMetric.days;
        annualMetric.lowest = Math.min(annualMetric.lowest, monthlyMetric.lowest);
        annualMetric.highest = Math.max(annualMetric.highest, monthlyMetric.highest);
      }
      months.push({ month: `${year}-${monthNumber}`, ...summarizePeriod(monthTotals, monthDays) });
      yearDays += monthDays;
    }
    years.push({ year, ...summarizePeriod(annualTotals, yearDays) });
  }

  return { months, years, units: { source: daily.source, temperature: "°C", precipitationTotal: "mm" } };
}
