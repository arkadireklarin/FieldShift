"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ApiError, ClimateMonth, ClimateSummary } from "@/types/api";
import styles from "./climate-panel.module.css";

interface ClimatePanelProps {
  climate?: ClimateSummary;
  fixtureMonths?: ClimateMonth[];
  loading: boolean;
  error?: ApiError["error"];
}

const monthLabel = new Intl.DateTimeFormat("en", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const retrievalLabel = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
const measurementLabel = new Intl.NumberFormat("en", { maximumSignificantDigits: 4 });

const metrics = [
  {
    label: "Temperature",
    description: "Monthly mean air temperature",
    value: "meanTemperatureC",
    unit: "°C",
    color: "#bc7548",
  },
  {
    label: "Precipitation",
    description: "Monthly precipitation total",
    value: "totalPrecipitationMm",
    unit: "mm",
    color: "#42765e",
  },
] as const;

function formatMonth(month: string) {
  return monthLabel.format(new Date(`${month}-01T00:00:00Z`));
}

function RetrievalTime({ value }: { value: string }) {
  return <time dateTime={value}>{retrievalLabel.format(new Date(value))} UTC</time>;
}

function formatMeasurement(value: number, unit: string) {
  return `${measurementLabel.format(value)} ${unit}`;
}

function ClimateChart({
  metric,
  months,
  emptyMessage,
}: {
  metric: (typeof metrics)[number];
  months: ClimateMonth[];
  emptyMessage: string;
}) {
  const isTemperature = metric.value === "meanTemperatureC";
  const available = months.filter((month) => month[metric.value] !== null).length;
  const Chart = isTemperature ? LineChart : BarChart;

  return (
    <figure className={styles.card}>
      <figcaption className={styles.cardHeader}>
        <div>
          <h3>{metric.label}</h3>
          <p>{metric.description}</p>
        </div>
        <span className={styles.unit}>{metric.unit}</span>
      </figcaption>

      {available > 0 ? (
        <div className={styles.chart}>
          <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
            <Chart data={months} margin={{ top: 12, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e7ebe4" strokeDasharray="3 4" />
              <XAxis
                dataKey="month"
                tickFormatter={formatMonth}
                minTickGap={24}
                tickLine={false}
                axisLine={{ stroke: "#e7ebe4" }}
                tick={{ fill: "#55655c", fontSize: 11 }}
              />
              <YAxis
                domain={isTemperature ? ["auto", "auto"] : [0, "auto"]}
                width={40}
                tickCount={5}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#55655c", fontSize: 11 }}
              />
              <Tooltip
                filterNull={false}
                formatter={(value) =>
                  typeof value === "number" ? formatMeasurement(value, metric.unit) : "Missing data"
                }
                labelFormatter={(label) => (typeof label === "string" ? formatMonth(label) : "")}
                contentStyle={{
                  border: "1px solid #dfe6dc",
                  borderRadius: "10px",
                  fontSize: "13px",
                }}
                isAnimationActive={false}
              />
              {isTemperature ? (
                <Line
                  type="linear"
                  dataKey={metric.value}
                  name={metric.label}
                  stroke={metric.color}
                  strokeWidth={2}
                  dot={{ r: 2, strokeWidth: 0, fill: metric.color }}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ) : (
                <Bar
                  dataKey={metric.value}
                  name={metric.label}
                  fill={metric.color}
                  radius={[2, 2, 0, 0]}
                  maxBarSize={30}
                  minPointSize={(value) => (value === 0 ? 2 : 0)}
                  isAnimationActive={false}
                />
              )}
            </Chart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className={styles.emptyChart}>
          <p>{months.length ? "No months have sufficient coverage." : emptyMessage}</p>
        </div>
      )}

      {months.length > 0 && (
        <p className={styles.coverage}>
          {available} of {months.length} months with data
        </p>
      )}
    </figure>
  );
}

function ClimateTable({ months }: { months: ClimateMonth[] }) {
  return (
    <details className={styles.tableDetails}>
      <summary>View monthly values and daily coverage</summary>
      <div className={styles.tableScroll}>
        <table>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Mean temperature</th>
              <th scope="col">Total precipitation</th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month.month}>
                <th scope="row">{formatMonth(month.month)}</th>
                <td>
                  {month.meanTemperatureC === null ? "Missing" : formatMeasurement(month.meanTemperatureC, "°C")}
                  <span>{month.temperatureDays}/{month.expectedDays} days</span>
                </td>
                <td>
                  {month.totalPrecipitationMm === null ? "Missing" : formatMeasurement(month.totalPrecipitationMm, "mm")}
                  <span>{month.precipitationDays}/{month.expectedDays} days</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default function ClimatePanel({ climate, fixtureMonths, loading, error }: ClimatePanelProps) {
  const months = [...(fixtureMonths ?? climate?.months ?? [])].sort((a, b) =>
    a.month.localeCompare(b.month),
  );
  const provenance = fixtureMonths ? undefined : climate?.provenance;
  const unavailable = error?.provenance;
  const missing = months.some(
    (month) => month.meanTemperatureC === null || month.totalPrecipitationMm === null,
  );
  const firstMonth = months.at(0);
  const lastMonth = months.at(-1);
  const emptyMessage = loading
    ? "Retrieving climate history…"
    : error
      ? "Climate data unavailable"
      : provenance || fixtureMonths
        ? "No monthly data returned."
        : "Analyze your field to load climate data.";

  return (
    <section id="climate" className={styles.section} aria-labelledby="climate-heading">
      <header className={styles.heading}>
        <div>
          <h2 id="climate-heading">Climate history</h2>
          <p>Historical temperature and precipitation for the selected location.</p>
        </div>
        <span className={fixtureMonths ? styles.fixtureBadge : styles.sourceBadge}>
          {fixtureMonths ? "Synthetic demo data" : "NASA POWER"}
        </span>
      </header>

      {loading && <p role="status" className={styles.status}>Retrieving historical climate data…</p>}
      {error && (
        <div className={styles.error} role="alert">
          <strong>Climate history unavailable</strong>
          <p>{error.message}</p>
          {unavailable && (
            <p>
              <a href={unavailable.sourceUrl} target="_blank" rel="noreferrer">NASA POWER request</a>
              {" · "}{unavailable.period.start} to {unavailable.period.end}
            </p>
          )}
        </div>
      )}

      {fixtureMonths && (
        <p className={styles.fixtureNotice}>
          Fictional example for local development, independent of your field inputs.
          {firstMonth && lastMonth && (
            <> Example period {formatMonth(firstMonth.month)} to {formatMonth(lastMonth.month)}.</>
          )}
        </p>
      )}

      {provenance && (
        <dl className={styles.provenance}>
          <div>
            <dt>Source</dt>
            <dd>
              <a href={provenance.sourceUrl} target="_blank" rel="noreferrer">{provenance.source}</a>
              {" · "}{provenance.kind === "cached_nasa_power" ? "Cached historical data" : "Historical data retrieved from source"}
            </dd>
          </div>
          <div>
            <dt>Observation period</dt>
            <dd>{provenance.period.start} to {provenance.period.end}</dd>
          </div>
          <div>
            <dt>Spatial scope</dt>
            <dd>Grid-cell estimates</dd>
          </div>
          <div>
            <dt>Retrieved</dt>
            <dd><RetrievalTime value={provenance.retrievedAt} /></dd>
          </div>
          {provenance.kind === "cached_nasa_power" && (
            <div>
              <dt>Cached</dt>
              <dd><RetrievalTime value={provenance.cachedAt} /></dd>
            </div>
          )}
        </dl>
      )}

      <div className={styles.charts} aria-busy={loading}>
        {metrics.map((metric) => (
          <ClimateChart key={metric.value} metric={metric} months={months} emptyMessage={emptyMessage} />
        ))}
      </div>

      {missing && (
        <p className={styles.status}>
          Months with insufficient daily coverage appear as gaps. A zero precipitation total represents a reported zero.
        </p>
      )}
      {provenance && climate && climate.limitations.length > 0 && (
        <ul className={styles.limitations}>
          {climate.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
        </ul>
      )}
      {months.length > 0 && <ClimateTable months={months} />}
    </section>
  );
}
