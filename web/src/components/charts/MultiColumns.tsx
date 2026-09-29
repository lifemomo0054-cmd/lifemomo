import { scaleBand, scaleLinear } from 'd3-scale';
import { useState } from 'react';
import { textWidth } from './textWidth';
import { Tooltip, type TooltipRow } from './Tooltip';
import { columnPath } from './TrendChart';
import { useWidth } from './useWidth';

export interface SeriesSpec {
  key: string;
  label: string;
  color: string; // CSS 색 (var(--…))
}

export interface GroupSpec {
  key: string;
  label: string;
  values: (number | null)[]; // 계열 순서
  title: string;
  tooltip: TooltipRow[];
}

const M = { top: 16, right: 8, bottom: 30 };
const GUTTER = 58;

/** 묶음 세로 막대 (계열 2~3개). 한 묶음에 마우스를 올리면 모든 계열 값을 한 툴팁에. */
export function GroupedColumns({
  series,
  groups,
  format,
  height = 260,
  label,
}: {
  series: SeriesSpec[];
  groups: GroupSpec[];
  format: (v: number) => string;
  height?: number;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  if (width < GUTTER + 60) return <div className="chart" ref={ref} style={{ height }} />;

  const x = scaleBand<string>().domain(groups.map((g) => g.key)).range([GUTTER, width - M.right]).paddingInner(0.28).paddingOuter(0.12);
  const inner = scaleBand<string>().domain(series.map((s) => s.key)).range([0, x.bandwidth()]).paddingInner(0.12);
  const barW = Math.min(24, inner.bandwidth());
  const max = Math.max(1, ...groups.flatMap((g) => g.values.map((v) => v ?? 0)));
  const y = scaleLinear().domain([0, max]).nice(4).range([height - M.bottom, M.top]);
  const a = active !== null ? groups[active] : null;

  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={label}>
        {y.ticks(4).map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'axis-line' : 'grid-line'} x1={GUTTER} x2={width - M.right} y1={y(t)} y2={y(t)} />
            <text className="tick" x={GUTTER - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {groups.map((g, gi) => (
          <g
            key={g.key}
            className="column"
            tabIndex={0}
            role="img"
            aria-label={`${g.title}: ${series.map((s, k) => `${s.label} ${g.values[k] === null ? '데이터 없음' : format(g.values[k]!)}`).join(', ')}`}
            onPointerEnter={() => setActive(gi)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(gi)}
            onBlur={() => setActive(null)}
          >
            <rect className="hit-area" x={x(g.key)! - (x.step() - x.bandwidth()) / 2} y={M.top} width={x.step()} height={height - M.top} />
            {g.values.every((v) => v === null) && (
              <text className="nodata-label" x={x(g.key)! + x.bandwidth() / 2} y={y(0) - 8} textAnchor="middle">
                데이터 없음
              </text>
            )}
            {series.map((s, k) => {
              const v = g.values[k];
              if (v === null || v <= 0) return null;
              const cx = x(g.key)! + inner(s.key)! + inner.bandwidth() / 2;
              return (
                <path
                  key={s.key}
                  d={columnPath(cx - barW / 2, y(v), barW, y(0) - y(v))}
                  style={{ fill: s.color, opacity: active === gi ? 0.8 : 1 }}
                />
              );
            })}
            <text className="tick tick-strong" x={x(g.key)! + x.bandwidth() / 2} y={height - M.bottom + 18} textAnchor="middle">
              {g.label}
            </text>
          </g>
        ))}
      </svg>
      {a && active !== null && <Tooltip x={x(a.key)! + x.bandwidth() / 2} y={M.top} width={width} title={a.title} rows={a.tooltip} />}
    </div>
  );
}

/** 100% 누적 세로 막대. 조각 사이 2px 틈, 한 막대에 마우스를 올리면 모든 조각 비중을 한 툴팁에. */
export function StackedColumns({
  series,
  groups,
  height = 260,
  label,
}: {
  series: SeriesSpec[];
  groups: GroupSpec[]; // values = 계열별 값 (비중은 여기서 계산)
  height?: number;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  if (width < GUTTER + 60) return <div className="chart" ref={ref} style={{ height }} />;

  const x = scaleBand<string>().domain(groups.map((g) => g.key)).range([GUTTER, width - M.right]).paddingInner(0.35).paddingOuter(0.15);
  const barW = Math.min(40, x.bandwidth());
  const y = scaleLinear().domain([0, 1]).range([height - M.bottom, M.top]);
  const a = active !== null ? groups[active] : null;
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={label}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'axis-line' : 'grid-line'} x1={GUTTER} x2={width - M.right} y1={y(t)} y2={y(t)} />
            <text className="tick" x={GUTTER - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {pct(t)}
            </text>
          </g>
        ))}
        {groups.map((g, gi) => {
          const total = g.values.reduce<number>((n, v) => n + (v ?? 0), 0);
          const cx = x(g.key)! + x.bandwidth() / 2;
          let acc = 0;
          return (
            <g
              key={g.key}
              className="column"
              tabIndex={0}
              role="img"
              aria-label={`${g.title}: ${series.map((s, k) => `${s.label} ${total > 0 ? pct((g.values[k] ?? 0) / total) : '데이터 없음'}`).join(', ')}`}
              onPointerEnter={() => setActive(gi)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(gi)}
              onBlur={() => setActive(null)}
            >
              <rect className="hit-area" x={x(g.key)! - (x.step() - x.bandwidth()) / 2} y={M.top} width={x.step()} height={height - M.top} />
              {total <= 0 ? (
                <text className="nodata-label" x={cx} y={y(0) - 8} textAnchor="middle">
                  데이터 없음
                </text>
              ) : (
                series.map((s, k) => {
                  const share = (g.values[k] ?? 0) / total;
                  const y0 = y(acc);
                  acc += share;
                  const h = y0 - y(acc) - (acc < 0.9999 ? 2 : 0); // 조각 사이 2px 틈
                  if (h <= 0) return null;
                  const pctText = pct(share);
                  const fits = h >= 16 && textWidth(pctText, 11) + 6 <= barW;
                  return (
                    <g key={s.key}>
                      <rect x={cx - barW / 2} y={y0 - h} width={barW} height={h} style={{ fill: s.color, opacity: active === gi ? 0.85 : 1 }} />
                      {fits && (
                        <text className={`seg-label seg-label-${k}`} x={cx} y={y0 - h / 2} dy="0.32em" textAnchor="middle">
                          {pctText}
                        </text>
                      )}
                    </g>
                  );
                })
              )}
              <text className="tick tick-strong" x={cx} y={height - M.bottom + 18} textAnchor="middle">
                {g.label}
              </text>
            </g>
          );
        })}
      </svg>
      {a && active !== null && <Tooltip x={x(a.key)! + x.bandwidth() / 2} y={M.top} width={width} title={a.title} rows={a.tooltip} />}
    </div>
  );
}
