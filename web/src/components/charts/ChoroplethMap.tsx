import { geoPath, geoTransverseMercator, type GeoPermissibleObjects } from 'd3-geo';
import { useMemo, useState } from 'react';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { Tooltip, type TooltipRow } from './Tooltip';
import { useWidth } from './useWidth';

export interface MapArea {
  key: string;
  label: string;
  shortLabel: string;
  feature: Feature<Geometry>;
  value: number; // 0 = 값 없음
  isStay: boolean;
  tooltip: TooltipRow[];
}

export interface Flow {
  key: string;
  value: number;
}

const BINS = 7;

/** 0보다 큰 값을 로그 눈금으로 7구간에 나눈다. 값 차이가 수천 배라 같은 폭 구간은 거의 다 한 색이 된다. */
export function logBins(values: number[]): number[] {
  const pos = values.filter((v) => v > 0);
  if (pos.length === 0) return [];
  const lo = Math.log10(Math.min(...pos));
  const hi = Math.log10(Math.max(...pos));
  if (hi - lo < 1e-9) return [Math.max(...pos)];
  return Array.from({ length: BINS - 1 }, (_, i) => 10 ** (lo + ((hi - lo) * (i + 1)) / BINS));
}

export function binOf(v: number, thresholds: number[]): number {
  if (v <= 0) return 0;
  let b = 1;
  for (const t of thresholds) if (v > t) b++;
  return Math.min(BINS, b);
}

/**
 * 시군구 단계구분도. 체류지는 먹색으로 칠하고, 상위 유입지에서 체류지로 가는 흐름선을 그린다.
 * focus 가 있으면 그 지역들에 맞춰 확대한다.
 */
export function ChoroplethMap({
  areas,
  borders,
  flows,
  focus,
  thresholds,
  highlight,
  onHover,
  label,
  height: fullHeight = 640,
}: {
  areas: MapArea[];
  borders?: GeoPermissibleObjects; // 시도 경계 (굵은 선)
  flows: Flow[];
  focus?: string[]; // 확대할 지역 key
  thresholds: number[];
  highlight?: string | null; // 목록에서 가리킨 지역
  onHover?: (key: string | null) => void;
  label: string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);
  // 좁은 화면에서는 너비에 맞춰 높이를 줄여야 확대한 범위가 화면을 채운다
  const height = width > 0 && width < 640 ? Math.min(fullHeight, Math.max(320, Math.round(width * 1.2))) : fullHeight;

  const geo = useMemo(() => {
    if (width < 80) return null;
    const target: FeatureCollection = {
      type: 'FeatureCollection',
      features: (focus?.length ? areas.filter((a) => focus.includes(a.key)) : areas).map((a) => a.feature),
    };
    const projection = geoTransverseMercator().rotate([-127.5, -38]).fitSize([width - 24, height - 24], target);
    projection.translate([projection.translate()[0] + 12, projection.translate()[1] + 12]);
    const path = geoPath(projection);
    const shapes = areas.map((a) => ({ ...a, d: path(a.feature) ?? '', c: path.centroid(a.feature) }));
    return { path, shapes, byKey: new Map(shapes.map((s) => [s.key, s])) };
  }, [areas, focus, width, height]);

  const stay = geo?.shapes.find((s) => s.isStay);
  const maxFlow = Math.max(1, ...flows.map((f) => f.value));
  const active = hover ? geo?.byKey.get(hover.key) : highlight ? geo?.byKey.get(highlight) : undefined;

  const enter = (key: string) => (e: React.PointerEvent<SVGPathElement>) => {
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    setHover({ key, x: e.clientX - box.left, y: e.clientY - box.top });
    onHover?.(key);
  };
  const leave = () => {
    setHover(null);
    onHover?.(null);
  };

  return (
    <div className="chart map" ref={ref} style={{ height }}>
      {geo && (
        <svg width={width} height={height} role="img" aria-label={label}>
          <defs>
            <clipPath id="map-clip">
              <rect x={0} y={0} width={width} height={height} />
            </clipPath>
          </defs>
          <g clipPath="url(#map-clip)">
            {geo.shapes.map((s) => (
              <path
                key={s.key}
                d={s.d}
                className={s.isStay ? 'area area-stay' : s.value > 0 ? `area seq-${binOf(s.value, thresholds)}` : 'area area-empty'}
                data-active={active?.key === s.key}
                onPointerMove={enter(s.key)}
                onPointerLeave={leave}
              />
            ))}
            {borders && <path className="sido-border" d={geo.path(borders) ?? ''} />}
            {stay &&
              flows.map((f) => {
                const o = geo.byKey.get(f.key);
                if (!o || o.isStay || !Number.isFinite(o.c[0])) return null;
                const [x1, y1] = o.c;
                const [x2, y2] = stay.c;
                const mx = (x1 + x2) / 2 - (y2 - y1) * 0.18;
                const my = (y1 + y2) / 2 + (x2 - x1) * 0.18;
                return (
                  <path
                    key={`flow-${f.key}`}
                    className="flow"
                    d={`M${x1},${y1}Q${mx},${my} ${x2},${y2}`}
                    style={{ strokeWidth: 0.8 + 5 * Math.sqrt(f.value / maxFlow) }}
                    data-active={active?.key === f.key}
                  />
                );
              })}
            {active && <path className="area-outline" d={active.d} />}
            {stay && (
              <g className="stay-marker" pointerEvents="none">
                <circle cx={stay.c[0]} cy={stay.c[1]} r={4} />
                <text x={stay.c[0] + 8} y={stay.c[1] - 8}>
                  {stay.shortLabel} (체류지)
                </text>
              </g>
            )}
          </g>
        </svg>
      )}
      {geo && hover && active && (
        <Tooltip x={hover.x} y={hover.y + 12} width={width} title={active.label} rows={active.tooltip} note={active.value <= 0 && !active.isStay ? '선택한 조건에서 값이 없습니다' : undefined} />
      )}
    </div>
  );
}
