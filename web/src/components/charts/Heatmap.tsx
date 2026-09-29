import { useState } from 'react';
import { Tooltip, type TooltipRow } from './Tooltip';
import { useWidth } from './useWidth';

export interface HeatCellSpec {
  row: number;
  col: number;
  value: number | null; // null = 데이터 없음
  tooltip: TooltipRow[];
  title: string;
}

const BINS = 7; // 파랑 한 가지 색의 명도 7단계 (--seq-1 … --seq-7)

/** 격자 히트맵. 값은 같은 폭의 7단계로 나눠 칠하고, 칸 안에는 값을 적는다. */
export function Heatmap({
  rows,
  cols,
  cells,
  format,
  label,
  rowHeader,
}: {
  rows: string[];
  cols: string[];
  cells: HeatCellSpec[];
  format: (v: number) => string;
  label: string;
  rowHeader?: number; // 행 이름 칸 너비
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<HeatCellSpec | null>(null);
  const max = Math.max(0, ...cells.map((c) => c.value ?? 0));
  const bin = (v: number) => (max > 0 ? Math.min(BINS, Math.max(1, Math.ceil((v / max) * BINS))) : 1);
  const left = rowHeader ?? 56;
  const top = 26;
  const cw = width > left ? (width - left) / cols.length : 0;
  const ch = 38;
  const height = top + rows.length * ch;
  const showValues = cw >= 58;

  return (
    <div className="chart heatmap" ref={ref}>
      {cw > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          {cols.map((c, j) => (
            <text key={c} className="tick tick-strong" x={left + cw * j + cw / 2} y={16} textAnchor="middle">
              {c}
            </text>
          ))}
          {rows.map((r, i) => (
            <text key={r} className="tick tick-strong" x={left - 10} y={top + ch * i + ch / 2} dy="0.32em" textAnchor="end">
              {r}
            </text>
          ))}
          {cells.map((c) => {
            const x = left + cw * c.col;
            const y = top + ch * c.row;
            const b = c.value === null ? 0 : bin(c.value);
            return (
              <g
                key={`${c.row}-${c.col}`}
                className="heat-cell"
                tabIndex={0}
                role="img"
                aria-label={`${c.title} ${c.value === null ? '데이터 없음' : format(c.value)}`}
                onPointerEnter={() => setActive(c)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(c)}
                onBlur={() => setActive(null)}
              >
                <rect
                  x={x + 1}
                  y={y + 1}
                  width={Math.max(0, cw - 2)}
                  height={ch - 2}
                  rx={2}
                  className={c.value === null ? 'heat-empty' : `seq-${b}`}
                  data-active={active === c}
                />
                {showValues && (
                  <text className={c.value === null ? 'heat-label heat-label-empty' : `heat-label seq-ink-${b}`} x={x + cw / 2} y={y + ch / 2} dy="0.32em" textAnchor="middle">
                    {c.value === null ? '—' : format(c.value)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {active && (
        <Tooltip
          x={left + cw * active.col + cw / 2}
          y={top + ch * (active.row + 1)}
          width={width}
          title={active.title}
          rows={active.tooltip}
          note={active.value === null ? '데이터 없음' : undefined}
        />
      )}
      <div className="scale-legend" aria-hidden="true">
        <span>0</span>
        {Array.from({ length: BINS }, (_, i) => (
          <span key={i} className={`scale-step seq-bg-${i + 1}`} />
        ))}
        <span>{format(max)}</span>
      </div>
    </div>
  );
}
