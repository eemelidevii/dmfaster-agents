"use client";

import {
  useId,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

const CHART_WIDTH = 1_000;
const CHART_HEIGHT = 260;
const CHART_LEFT = 54;
const CHART_RIGHT = 18;
const CHART_TOP = 16;
const CHART_BOTTOM = 34;
const PLOT_WIDTH = CHART_WIDTH - CHART_LEFT - CHART_RIGHT;
const PLOT_HEIGHT = CHART_HEIGHT - CHART_TOP - CHART_BOTTOM;

export type AnalyticsChartDatum = {
  id: string;
  label: string;
  fullLabel: string;
  values: number[];
};

export type AnalyticsChartSeries = {
  label: string;
  color: string;
  areaColor?: string;
  dashed?: boolean;
  width?: number;
};

function smoothLinePath(values: number[], getY: (value: number) => number) {
  if (!values.length) return "";
  const getX = (index: number) => CHART_LEFT + (values.length === 1 ? PLOT_WIDTH / 2 : (index / (values.length - 1)) * PLOT_WIDTH);
  let path = `M ${getX(0)} ${getY(values[0] ?? 0)}`;

  for (let index = 1; index < values.length; index += 1) {
    const previousX = getX(index - 1);
    const currentX = getX(index);
    const midX = (previousX + currentX) / 2;
    path += ` C ${midX} ${getY(values[index - 1] ?? 0)}, ${midX} ${getY(values[index] ?? 0)}, ${currentX} ${getY(values[index] ?? 0)}`;
  }

  return path;
}

export function AnalyticsMetricCard({
  label,
  value,
  detail,
  accent,
  action,
}: {
  label: string;
  value: string;
  detail: string;
  accent: string;
  action?: ReactNode;
}) {
  return (
    <article className="relative overflow-hidden rounded-lg border border-slate-200 bg-white px-4 py-4">
      <span className={`absolute inset-x-0 top-0 h-0.5 ${accent}`} />
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
        {action}
      </div>
      <p className="mt-3 text-3xl font-bold tracking-[-0.04em] text-slate-950">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </article>
  );
}

function LegendItem({ series }: { series: AnalyticsChartSeries }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
      <span
        className={`h-0.5 w-5 ${series.dashed ? "border-t border-dashed bg-transparent" : ""}`}
        style={series.dashed ? { borderColor: series.color } : { backgroundColor: series.color }}
      />
      {series.label}
    </span>
  );
}

export function AnalyticsLineChartCard({
  title,
  description,
  data,
  series,
  emptyLabel,
  note,
  ariaLabel,
  formatValue = (value) => new Intl.NumberFormat("en-US").format(value),
  formatCompactValue = (value) => new Intl.NumberFormat("en-US", {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000 ? 1 : 0,
  }).format(value),
}: {
  title: string;
  description: string;
  data: AnalyticsChartDatum[];
  series: AnalyticsChartSeries[];
  emptyLabel: string;
  note?: ReactNode;
  ariaLabel?: string;
  formatValue?: (value: number) => string;
  formatCompactValue?: (value: number) => string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const gradientId = useId().replaceAll(":", "");
  const values = data.flatMap((point) => point.values);
  const maxValue = Math.max(1, ...values);
  const chartMax = Math.max(1, Math.ceil(maxValue * 1.12));
  const getY = (value: number) => CHART_TOP + PLOT_HEIGHT - (value / chartMax) * PLOT_HEIGHT;
  const baselineY = CHART_TOP + PLOT_HEIGHT;
  const paths = series.map((_entry, seriesIndex) => smoothLinePath(
    data.map((point) => point.values[seriesIndex] ?? 0),
    getY,
  ));
  const yTicks = Array.from(new Set(
    Array.from({ length: 5 }, (_, index) => Math.round((chartMax / 4) * index)),
  ));
  const xTickIndexes = Array.from(new Set([
    0,
    Math.round((data.length - 1) * .25),
    Math.round((data.length - 1) * .5),
    Math.round((data.length - 1) * .75),
    data.length - 1,
  ])).filter((index) => index >= 0 && index < data.length);
  const hoveredPoint = hoveredIndex === null ? null : data[hoveredIndex] ?? null;
  const hoveredX = hoveredIndex === null
    ? 0
    : CHART_LEFT + (data.length === 1 ? PLOT_WIDTH / 2 : (hoveredIndex / Math.max(1, data.length - 1)) * PLOT_WIDTH);
  const isEmpty = values.every((value) => value === 0);

  function handleChartPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!data.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - bounds.left) / bounds.width) * CHART_WIDTH;
    const ratio = Math.max(0, Math.min(1, (pointerX - CHART_LEFT) / PLOT_WIDTH));
    setHoveredIndex(Math.round(ratio * Math.max(0, data.length - 1)));
  }

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-950">{title}</h2>
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {series.map((entry) => <LegendItem key={entry.label} series={entry} />)}
        </div>
      </div>

      <div className="px-3 pb-3 pt-2 sm:px-4">
        <div className="relative min-h-[220px] w-full sm:min-h-[260px]">
          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            className="h-[220px] w-full overflow-visible sm:h-[260px]"
            role="img"
            aria-label={ariaLabel || title}
            onPointerMove={handleChartPointerMove}
            onPointerLeave={() => setHoveredIndex(null)}
          >
            <title>{title}</title>
            <defs>
              {series.map((entry, index) => entry.areaColor ? (
                <linearGradient key={entry.label} id={`${gradientId}-${index}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={entry.areaColor} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={entry.areaColor} stopOpacity="0.02" />
                </linearGradient>
              ) : null)}
            </defs>

            {yTicks.map((tick) => {
              const y = getY(tick);
              return (
                <g key={tick}>
                  <line x1={CHART_LEFT} y1={y} x2={CHART_LEFT + PLOT_WIDTH} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                  <text x={CHART_LEFT - 12} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="11" fontWeight="600">
                    {formatCompactValue(tick)}
                  </text>
                </g>
              );
            })}

            {xTickIndexes.map((index) => {
              const point = data[index];
              const x = CHART_LEFT + (data.length === 1 ? PLOT_WIDTH / 2 : (index / Math.max(1, data.length - 1)) * PLOT_WIDTH);
              return point ? (
                <text key={`${point.id}-${index}`} x={x} y={CHART_HEIGHT - 12} textAnchor="middle" fill="#94a3b8" fontSize="11" fontWeight="600">
                  {point.label}
                </text>
              ) : null;
            })}

            {series.map((entry, index) => {
              const path = paths[index] ?? "";
              const areaPath = path ? `${path} L ${CHART_LEFT + PLOT_WIDTH} ${baselineY} L ${CHART_LEFT} ${baselineY} Z` : "";
              return (
                <g key={entry.label}>
                  {entry.areaColor && areaPath ? <path d={areaPath} fill={`url(#${gradientId}-${index})`} /> : null}
                  {path ? (
                    <path
                      d={path}
                      fill="none"
                      stroke={entry.color}
                      strokeWidth={entry.width ?? 2.5}
                      strokeDasharray={entry.dashed ? "7 6" : undefined}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}
                </g>
              );
            })}

            {hoveredPoint ? (
              <g>
                <line x1={hoveredX} y1={CHART_TOP} x2={hoveredX} y2={baselineY} stroke="#94a3b8" strokeDasharray="4 5" strokeWidth="1" />
                {series.map((entry, index) => (
                  <circle
                    key={entry.label}
                    cx={hoveredX}
                    cy={getY(hoveredPoint.values[index] ?? 0)}
                    r={index === 0 ? 5 : 4}
                    fill="#ffffff"
                    stroke={entry.color}
                    strokeWidth={index === 0 ? 3 : 2.5}
                  />
                ))}
              </g>
            ) : null}
          </svg>

          {hoveredPoint ? (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-48 rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs shadow-[0_12px_30px_rgba(15,23,42,0.12)]"
              style={{
                left: `${(hoveredX / CHART_WIDTH) * 100}%`,
                transform: hoveredX > CHART_WIDTH * .76 ? "translateX(-100%)" : "translateX(12px)",
              }}
            >
              <p className="font-bold text-slate-950">{hoveredPoint.fullLabel}</p>
              <div className="mt-2 space-y-1.5 text-slate-500">
                {series.map((entry, index) => (
                  <p key={entry.label} className="flex items-center justify-between gap-5">
                    <span>{entry.label}</span>
                    <strong className="text-slate-950">{formatValue(hoveredPoint.values[index] ?? 0)}</strong>
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          {isEmpty ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-lg border border-slate-200 bg-white/90 px-4 py-3 text-sm font-semibold text-slate-500">
                {emptyLabel}
              </div>
            </div>
          ) : null}
        </div>

        {note ? (
          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] leading-4 text-slate-500">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0 text-slate-400">
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 8.5v4M10 6.2h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>{note}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
