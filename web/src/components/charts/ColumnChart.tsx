import { scaleBand, scaleLinear } from 'd3-scale';
import { useState } from 'react';
import { Tooltip, type TooltipRow } from './Tooltip';
import { columnPath } from './TrendChart';
import { useWidth } from './useWidth';

export interface Column {
  key: string;
  label: string;
  value: number | null; // null = 데이터 없음 (0과 구분)
  emphasis?: boolean;
  tooltip: TooltipRow[];
  tooltipTitle: string;
  emptyNote?: string;
}

const M = { top: 24, right: 8, bottom: 30, left: 8 };

/**
 * 세로 막대. 막대가 적어서 값을 막대 끝에 모두 적고, 세로축 눈금은 생략한다.
 * emphasis 가 하나라도 있으면 그 막대만 강조색, 나머지는 회색(강조 형식).
 */
export function ColumnChart({
  columns,
  format,
  height = 220,
  label,
}: {
  columns: Column[];
  format: (v: number) => string;
  height?: number;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const emphasis = columns.some((c) => c.emphasis);

  if (width < M.left + M.right + 40) return <div className="chart" ref={ref} style={{ height }} />;

  const x = scaleBand<string>()
    .domain(columns.map((c) => c.key))
    .range([M.left, width - M.right])
    .paddingInner(0.2)
    .paddingOuter(0.1);
  const max = Math.max(1, ...columns.map((c) => c.value ?? 0));
  const y = scaleLinear().domain([0, max]).range([height - M.bottom, M.top + 4]);
  const barW = Math.min(24, x.bandwidth());
  const a = active !== null ? columns[active] : null;

  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={label}>
        <line className="axis-line" x1={M.left} x2={width - M.right} y1={y(0)} y2={y(0)} />
        {columns.map((c, i) => {
          const cx = x(c.key)! + x.bandwidth() / 2;
          const cls = !emphasis || c.emphasis ? 'mark-accent' : 'mark-muted';
          return (
            <g
              key={c.key}
              className="column"
              tabIndex={0}
              role="img"
              aria-label={`${c.tooltipTitle} ${c.value === null ? c.emptyNote ?? '데이터 없음' : format(c.value)}`}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <rect className="hit-area" x={x(c.key)!} y={M.top} width={x.bandwidth()} height={height - M.top} />
              {c.value !== null ? (
                <>
                  <path
                    className={`${cls}${active === i ? ' is-active' : ''}`}
                    d={columnPath(cx - barW / 2, y(c.value), barW, y(0) - y(c.value))}
                  />
                  <text className="value-label" x={cx} y={y(c.value) - 6} textAnchor="middle">
                    {format(c.value)}
                  </text>
                </>
              ) : (
                <text className="nodata-label" x={cx} y={y(0) - 8} textAnchor="middle">
                  {c.emptyNote ?? '없음'}
                </text>
              )}
              <text className="tick tick-strong" x={cx} y={height - M.bottom + 18} textAnchor="middle">
                {c.label}
              </text>
            </g>
          );
        })}
      </svg>
      {a && active !== null && (
        <Tooltip
          x={x(a.key)! + x.bandwidth() / 2}
          y={M.top}
          width={width}
          title={a.tooltipTitle}
          rows={a.tooltip}
          note={a.value === null ? a.emptyNote ?? '데이터 없음' : undefined}
        />
      )}
    </div>
  );
}
