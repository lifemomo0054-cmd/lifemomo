import { scaleBand, scaleLinear } from 'd3-scale';
import { useState } from 'react';
import { Tooltip, type TooltipRow } from './Tooltip';
import { columnPath } from './TrendChart';
import { textWidth } from './textWidth';
import { useWidth } from './useWidth';

export interface Column {
  key: string;
  label: string;
  shortLabel?: string; // 자리가 좁을 때 x축에 쓰는 짧은 이름
  value: number | null; // null = 데이터 없음 (0과 구분)
  emphasis?: boolean;
  tooltip: TooltipRow[];
  tooltipTitle: string;
  emptyNote?: string;
}

const M = { top: 24, right: 8, bottom: 30 };
const TICK_GUTTER = 58; // 세로축 눈금을 그릴 때 왼쪽 여백

/**
 * 세로 막대. 자리가 넉넉하면 값을 막대 끝에 적고 세로축 눈금을 생략한다.
 * 좁으면 막대 끝 값 대신 세로축 눈금을 그리고, 값은 툴팁·표 보기로 읽는다.
 * emphasis 가 하나라도 있으면 그 막대만 강조색, 나머지는 회색(강조 형식).
 */
export function ColumnChart({
  columns,
  format,
  height: fullHeight = 240,
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
  const height = width > 0 && width < 400 ? Math.min(fullHeight, 260) : fullHeight; // 좁은 화면(모바일)에서는 낮게

  if (width < TICK_GUTTER + M.right + 40) return <div className="chart" ref={ref} style={{ height }} />;

  const band = (left: number) =>
    scaleBand<string>()
      .domain(columns.map((c) => c.key))
      .range([left, width - M.right])
      .paddingInner(0.2)
      .paddingOuter(0.1);
  const widest = Math.max(0, ...columns.map((c) => (c.value === null ? 0 : textWidth(format(c.value), 11.5))));
  const labelsFit = band(8).step() >= widest + 6;
  const left = labelsFit ? 8 : TICK_GUTTER;
  const x = band(left);
  const useShort = columns.some((c) => textWidth(c.label, 12) > x.step() - 4);
  // 짧은 이름으로도 겹치면 k개마다 하나씩만 적는다
  const labelW = Math.max(...columns.map((c) => textWidth(useShort ? c.shortLabel ?? c.label : c.label, 12)));
  const every = Math.max(1, Math.ceil((labelW + 8) / x.step()));

  const max = Math.max(1, ...columns.map((c) => c.value ?? 0));
  const y = scaleLinear().domain([0, max]).range([height - M.bottom, M.top + 4]);
  if (!labelsFit) y.nice(4); // 눈금을 그릴 때만 깔끔한 수로 늘린다
  const barW = Math.min(24, x.bandwidth());
  const a = active !== null ? columns[active] : null;

  // 연속된 빈 칸(데이터 없음)은 띠 하나로 묶고, 자리가 되면 가운데에 한 번만 적는다
  const gaps: { from: number; to: number }[] = [];
  columns.forEach((c, i) => {
    if (c.value !== null) return;
    const last = gaps[gaps.length - 1];
    if (last && last.to === i - 1) last.to = i;
    else gaps.push({ from: i, to: i });
  });
  const gapNote = (g: { from: number; to: number }) => columns[g.from].emptyNote ?? '데이터 없음';

  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={label}>
        {!labelsFit &&
          y.ticks(4).map((t) => (
            <g key={t}>
              {t > 0 && <line className="grid-line" x1={left} x2={width - M.right} y1={y(t)} y2={y(t)} />}
              <text className="tick" x={left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {format(t)}
              </text>
            </g>
          ))}
        {gaps.map((g) => {
          const x0 = x(columns[g.from].key)! - (x.step() - x.bandwidth()) / 2;
          const w = x.step() * (g.to - g.from + 1);
          const note = gapNote(g);
          return (
            <g key={`gap-${g.from}`}>
              <rect className="nodata-band" x={x0} y={M.top} width={w} height={y(0) - M.top} />
              {textWidth(note, 11) + 8 <= w && (
                <text className="nodata-label" x={x0 + w / 2} y={M.top + 14} textAnchor="middle">
                  {note}
                </text>
              )}
            </g>
          );
        })}
        <line className="axis-line" x1={left} x2={width - M.right} y1={y(0)} y2={y(0)} />
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
              <rect className="hit-area" x={x(c.key)! - (x.step() - x.bandwidth()) / 2} y={M.top} width={x.step()} height={height - M.top} />
              {c.value !== null ? (
                <>
                  <path
                    className={`${cls}${active === i ? ' is-active' : ''}`}
                    d={columnPath(cx - barW / 2, y(c.value), barW, y(0) - y(c.value))}
                  />
                  {labelsFit && (
                    <text className="value-label" x={cx} y={y(c.value) - 6} textAnchor="middle">
                      {format(c.value)}
                    </text>
                  )}
                </>
              ) : null}
              {i % every === 0 && (
                <text className="tick tick-strong" x={cx} y={height - M.bottom + 18} textAnchor="middle">
                  {useShort ? c.shortLabel ?? c.label : c.label}
                </text>
              )}
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
