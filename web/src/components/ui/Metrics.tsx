import { scaleLinear } from 'd3-scale';
import { line } from 'd3-shape';
import type { ReactNode } from 'react';
import { useWidth } from '../charts/useWidth';

/** 대표 숫자 한 개 (화면당 하나) */
export function HeroMetric({
  label,
  value,
  unit,
  sub,
  trend,
  trendLabel,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
  trend?: (number | null)[];
  trendLabel?: string;
}) {
  return (
    <div className="hero">
      <p className="hero-label">{label}</p>
      <p className="hero-value">
        {value}
        {unit && <span className="hero-unit">{unit}</span>}
      </p>
      {sub && <p className="hero-sub">{sub}</p>}
      {trend && trend.some((v) => v !== null) && (
        <figure className="hero-trend">
          <Sparkline values={trend} label={trendLabel ?? ''} />
          {trendLabel && <figcaption>{trendLabel}</figcaption>}
        </figure>
      )}
    </div>
  );
}

export function StatTile({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: ReactNode }) {
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </p>
      {sub && <p className="stat-sub">{sub}</p>}
    </div>
  );
}

/** 작은 추이 선. 데이터 없는 구간은 끊는다. */
export function Sparkline({ values, label, height = 44 }: { values: (number | null)[]; label: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const x = scaleLinear().domain([0, Math.max(1, values.length - 1)]).range([2, Math.max(8, width - 6)]);
  const y = scaleLinear().domain([0, max]).range([height - 4, 5]);
  const d =
    line<number | null>()
      .defined((v) => v !== null)
      .x((_, i) => x(i))
      .y((v) => y(v ?? 0))(values) ?? '';
  let last = -1;
  values.forEach((v, i) => v !== null && (last = i));

  return (
    <div className="sparkline" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          <line className="axis-line" x1={0} x2={width} y1={height - 1.5} y2={height - 1.5} />
          <path className="spark-line" d={d} />
          {last >= 0 && <circle className="mark-dot" cx={x(last)} cy={y(values[last]!)} r={3.5} />}
        </svg>
      )}
    </div>
  );
}
