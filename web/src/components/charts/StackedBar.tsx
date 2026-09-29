import { useState } from 'react';
import type { SharePoint } from '../../data/engine';
import { fmtInt, fmtPct } from '../../data/format';

/** 100% 누적 가로 막대 + 아래에 항목별 값(범례 겸 직접 라벨). 조각 사이는 2px 틈. */
export function StackedBar({ title, parts, colors }: { title: string; parts: SharePoint[]; colors: string[] }) {
  const [active, setActive] = useState<string | null>(null);
  const shown = parts.filter((p) => (p.share ?? 0) > 0);

  return (
    <div className="stacked">
      <p className="stacked-title">{title}</p>
      <div className="stacked-bar" role="img" aria-label={`${title}: ${parts.map((p) => `${p.label} ${fmtPct(p.share)}`).join(', ')}`}>
        {shown.length === 0 && <span className="stacked-empty" />}
        {shown.map((p) => (
          <span
            key={p.key}
            className="stacked-seg"
            data-active={active === p.key}
            data-dim={active !== null && active !== p.key}
            style={{ flexGrow: p.share ?? 0, background: colors[parts.indexOf(p)] }}
            onPointerEnter={() => setActive(p.key)}
            onPointerLeave={() => setActive(null)}
          />
        ))}
      </div>
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
