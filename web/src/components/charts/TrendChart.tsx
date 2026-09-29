import { scaleLinear } from 'd3-scale';
import { curveMonotoneX, line } from 'd3-shape';
import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { shortDay } from '../../data/dates';
import type { DailyPoint } from '../../data/engine';
import { fmtInt } from '../../data/format';
import { Tooltip } from './Tooltip';
import { useWidth } from './useWidth';

const M = { top: 20, right: 64, bottom: 30, left: 60 };

/** 위쪽만 둥근 막대 (바닥은 각지게) */
export function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0 || w <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

interface Props {
  points: DailyPoint[];
  height?: number;
  label: string;
}

/** 일별 합계(연한 막대) + 7일 이동평균(선). 데이터 없는 날은 비워 두고 띠로 표시한다. */
export function TrendChart({ points, height = 280, label }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const geo = useMemo(() => {
    // 그릴 자리가 너무 좁으면(레이아웃 도중 등) 그리지 않는다
    if (width < M.left + M.right + 40 || points.length === 0) return null;
    const n = points.length;
    const x = scaleLinear().domain([0, Math.max(1, n - 1)]).range([M.left, width - M.right]);
    const step = n > 1 ? x(1) - x(0) : width - M.left - M.right;
    const max = Math.max(1, ...points.map((p) => p.value ?? 0));
    const y = scaleLinear().domain([0, max]).nice(4).range([height - M.bottom, M.top]);
    const barW = Math.max(1, Math.min(24, step * 0.62));

    const gaps: { from: number; to: number }[] = [];
    points.forEach((p, i) => {
      if (p.hasData) return;
      const last = gaps[gaps.length - 1];
      if (last && last.to === i - 1) last.to = i;
      else gaps.push({ from: i, to: i });
    });

    const path =
      line<DailyPoint>()
        .defined((p) => p.ma7 !== null)
        .x((_, i) => x(i))
        .y((p) => y(p.ma7 ?? 0))
        .curve(curveMonotoneX)(points) ?? '';

    // x축: 기간이 길면 매월 1일, 짧으면 월요일마다
    const ticks: { i: number; label: string }[] = [];
    points.forEach((p, i) => {
      const isTick = n > 60 ? p.day.endsWith('-01') || i === 0 : p.weekday === 0 || i === 0;
      const prev = ticks[ticks.length - 1];
      if (!isTick || (prev && x(i) - x(prev.i) < (n > 60 ? 28 : 40))) return; // 앞 라벨과 겹치면 건너뛴다
      ticks.push({ i, label: n > 60 ? `${Number(p.day.slice(5, 7))}월` : shortDay(p.day) });
    });

    let lastIdx = -1;
    points.forEach((p, i) => p.ma7 !== null && (lastIdx = i));

    return { x, y, step, barW, gaps, path, ticks, lastIdx };
  }, [points, width, height]);

  const move = (e: PointerEvent<SVGRectElement>) => {
    if (!geo) return;
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const i = Math.round(geo.x.invert(e.clientX - box.left));
    setActive(Math.max(0, Math.min(points.length - 1, i)));
  };

  const key = (e: KeyboardEvent<SVGSVGElement>) => {
    const last = points.length - 1;
    const cur = active ?? (geo?.lastIdx ?? last);
    const next =
      e.key === 'ArrowLeft' ? cur - 1 : e.key === 'ArrowRight' ? cur + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (next === null) return;
    e.preventDefault();
    setActive(Math.max(0, Math.min(last, next)));
  };

  const a = active !== null ? points[active] : null;

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {geo && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          tabIndex={0}
          onKeyDown={key}
          onFocus={() => setActive((v) => v ?? (geo.lastIdx >= 0 ? geo.lastIdx : null))}
          onBlur={() => setActive(null)}
        >
          {geo.y.ticks(4).map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'axis-line' : 'grid-line'} x1={M.left} x2={width - M.right + 8} y1={geo.y(t)} y2={geo.y(t)} />
              <text className="tick" x={M.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end">
                {fmtInt(t)}
              </text>
            </g>
          ))}

          {geo.gaps.map((g) => {
            const x0 = geo.x(g.from) - geo.step / 2;
            const w = geo.x(g.to) - geo.x(g.from) + geo.step;
            return (
              <g key={g.from}>
                <rect className="nodata-band" x={x0} y={M.top} width={w} height={height - M.top - M.bottom} />
                {w > 64 && (
                  <text className="nodata-label" x={x0 + w / 2} y={M.top + 14} textAnchor="middle">
                    데이터 없음
                  </text>
                )}
              </g>
            );
          })}

          {points.map((p, i) =>
            p.value !== null && p.value > 0 ? (
              <path
                key={p.day}
                className={i === active ? 'mark-muted is-active' : 'mark-muted'}
                d={columnPath(geo.x(i) - geo.barW / 2, geo.y(p.value), geo.barW, geo.y(0) - geo.y(p.value), geo.barW >= 6 ? 4 : 0)}
              />
            ) : null,
          )}

          <path className="mark-line" d={geo.path} />

          {geo.ticks.map((t) => (
            <text key={t.i} className="tick" x={geo.x(t.i)} y={height - M.bottom + 18} textAnchor="middle">
              {t.label}
            </text>
          ))}

          {geo.lastIdx >= 0 && active === null && (
            <g>
              <circle className="mark-dot" cx={geo.x(geo.lastIdx)} cy={geo.y(points[geo.lastIdx].ma7!)} r={4} />
              <text className="end-label" x={geo.x(geo.lastIdx) + 8} y={geo.y(points[geo.lastIdx].ma7!)} dy="0.32em">
                {fmtInt(points[geo.lastIdx].ma7)}
              </text>
            </g>
          )}

          {a && active !== null && (
            <g pointerEvents="none">
              <line className="crosshair" x1={geo.x(active)} x2={geo.x(active)} y1={M.top} y2={height - M.bottom} />
              {a.ma7 !== null && <circle className="mark-dot" cx={geo.x(active)} cy={geo.y(a.ma7)} r={4} />}
            </g>
          )}

          <rect
            className="hit-area"
            x={M.left - geo.step / 2}
            y={M.top}
            width={width - M.left - M.right + geo.step}
            height={height - M.top - M.bottom}
            onPointerMove={move}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      )}
      {geo && a && active !== null && (
        <Tooltip
          x={geo.x(active)}
          y={M.top}
          width={width}
          title={shortDay(a.day, true)}
          rows={
            a.hasData
              ? [
                  { label: '일별 합계', value: fmtInt(a.value), swatch: 'rect', color: 'var(--deemph)' },
                  { label: '7일 이동평균', value: fmtInt(a.ma7), swatch: 'line', color: 'var(--series-1)' },
                ]
              : []
          }
          note={a.hasData ? undefined : '이날은 데이터가 없습니다.'}
        />
      )}
    </div>
  );
}
