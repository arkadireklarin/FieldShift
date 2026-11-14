import type { ClimateMonth, ClimateSummary } from "../../types/api";

type MonthlyWeather = {
  meanTemperatureC: number;
  totalPrecipitationMm: number;
};

type CompleteYear = {
  year: number;
  precipitationMm: number;
  months: MonthlyWeather[];
};

function monthLabel(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function monthDays(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function completeYear(year: number, observations: Map<string, ClimateMonth>): CompleteYear | undefined {
  const months: MonthlyWeather[] = [];
  let precipitationMm = 0;

  for (let month = 1; month <= 12; month++) {
    const observation = observations.get(monthLabel(year, month));
    if (!observation) return undefined;
    const { meanTemperatureC, totalPrecipitationMm, expectedDays, temperatureDays, precipitationDays } = observation;
    if (expectedDays !== monthDays(year, month) || temperatureDays !== expectedDays || precipitationDays !== expectedDays ||
        meanTemperatureC === null || !Number.isFinite(meanTemperatureC) ||
        totalPrecipitationMm === null || !Number.isFinite(totalPrecipitationMm) || totalPrecipitationMm < 0) {
      return undefined;
    }
    months.push({ meanTemperatureC, totalPrecipitationMm });
    precipitationMm += totalPrecipitationMm;
  }

  // Monthly sums can contain floating point residue from adding daily totals.
  return { year, precipitationMm: Math.round(precipitationMm * 1_000_000) / 1_000_000, months };
}

export function buildHistoricalStress(climate: ClimateSummary): {
  year: number;
  precipitationMm: number;
  medianPrecipitationMm: number;
  completeYears: number;
  climate: ClimateSummary;
} | undefined {
  const { start, end } = climate.provenance.period;
  const firstYear = Number(start.slice(0, 4));
  const lastYear = Number(end.slice(0, 4));
  const observations = new Map(climate.months.map((month) => [month.month, month]));
  const completeYears: CompleteYear[] = [];

  for (let year = firstYear; year <= lastYear; year++) {
    if (`${monthLabel(year, 1)}-01` < start || `${monthLabel(year, 12)}-31` > end) continue;
    const history = completeYear(year, observations);
    if (history) completeYears.push(history);
  }
  if (completeYears.length < 2) return undefined;

  completeYears.sort((a, b) => a.precipitationMm - b.precipitationMm || a.year - b.year);
  const middle = Math.floor(completeYears.length / 2);
  const medianPrecipitationMm = completeYears.length % 2 === 0
    ? (completeYears[middle - 1].precipitationMm + completeYears[middle].precipitationMm) / 2
    : completeYears[middle].precipitationMm;
  const driest = completeYears[0];
  if (driest.precipitationMm >= medianPrecipitationMm) return undefined;

  const months: ClimateMonth[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    for (let month = 1; month <= 12; month++) {
      const label = monthLabel(year, month);
      if (label < start.slice(0, 7) || label > end.slice(0, 7)) continue;
      const days = monthDays(year, month);
      months.push({
        month: label,
        ...driest.months[month - 1],
        expectedDays: days,
        temperatureDays: days,
        precipitationDays: days,
      });
    }
  }

  return {
    year: driest.year,
    precipitationMm: driest.precipitationMm,
    medianPrecipitationMm,
    completeYears: completeYears.length,
    climate: {
      months,
      provenance: climate.provenance,
      limitations: [
        ...climate.limitations,
        `The stress replay repeats observed monthly temperatures and rainfall from ${driest.year}. It does not forecast future conditions.`,
      ],
    },
  };
}
