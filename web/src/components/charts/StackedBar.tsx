import { useState, type PointerEvent, type ReactNode } from 'react';
import type { SharePoint } from '../../data/engine';
import { fmtInt, fmtPct } from '../../data/format';
import { Tooltip, type TooltipRow } from './Tooltip';

interface Hover {
  key: string;
  x: number;
}

/** 조각 위에 마우스를 올리면 툴팁을 띄우는 100% 누적 막대 (조각 사이 2px 틈) */
export function SegmentBar({
  parts,
  colors,
  height = 14,
  label,
  tooltip,
  onActive,
}: {
  parts: SharePoint[];
  colors: string[];
  height?: number;
  label: string;
  tooltip: (p: SharePoint) => { title: ReactNode; rows: TooltipRow[] };
  onActive?: (key: string | null) => void;
}) {
  const [hover, setHover] = useState<Hover | null>(null);
  const [width, setWidth] = useState(0);
  const shown = parts.filter((p) => (p.share ?? 0) > 0);
  const active = hover ? parts.find((p) => p.key === hover.key) : undefined;

  const move = (p: SharePoint) => (e: PointerEvent<HTMLSpanElement>) => {
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    setWidth(box.width);
    setHover({ key: p.key, x: e.clientX - box.left });
    onActive?.(p.key);
  };
  const leave = () => {
    setHover(null);
    onActive?.(null);
  };

  return (
    <div className="segbar" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${fmtPct(p.share)}`).join(', ')}`}>
      <div className="stacked-bar" style={{ height }}>
        {shown.length === 0 && <span className="stacked-empty" />}
        {shown.map((p) => (
          <span
            key={p.key}
            className="stacked-seg"
            data-dim={hover !== null && hover.key !== p.key}
            style={{ flexGrow: p.share ?? 0, background: colors[parts.indexOf(p)] }}
            onPointerMove={move(p)}
            onPointerLeave={leave}
          />
        ))}
      </div>
      {active && hover && (
        <Tooltip x={hover.x} y={height + 6} width={width} {...tooltip(active)} />
      )}
    </div>
  );
}

/** 전체 구성: 누적 막대 + 아래에 항목별 값(범례 겸 직접 라벨) */
export function StackedBar({
  title,
  parts,
  colors,
  unit = '명',
}: {
  title: string;
  parts: SharePoint[];
  colors: string[];
  unit?: string;
}) {
  const [active, setActive] = useState<string | null>(null);

  return (
    <div className="stacked">
      {title && <p className="stacked-title">{title}</p>}
      <SegmentBar
        parts={parts}
        colors={colors}
        height={16}
        label={title}
        onActive={setActive}
        tooltip={(p) => ({
          title: p.label,
          rows: [
            { label: unit, value: fmtInt(p.value) },
            { label: '비중', value: fmtPct(p.share) },
          ],
        })}
      />
      <ul className="stacked-legend">
        {parts.map((p, i) => (
          <li
            key={p.key}
            data-active={active === p.key}
            tabIndex={0}
            onPointerEnter={() => setActive(p.key)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(p.key)}
            onBlur={() => setActive(null)}
          >
            <span className="key key-rect" style={{ background: colors[i] }} aria-hidden="true" />
            <span className="stacked-name">
              {p.label}
              {p.note && <span className="stacked-note">{p.note}</span>}
            </span>
            <span className="stacked-value">{fmtInt(p.value)}</span>
            <strong className="stacked-share">{fmtPct(p.share)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
