import { useState } from 'react';
import type { TooltipRow } from './Tooltip';

export interface BarItem {
  key: string;
  rank?: number;
  label: string;
  prefix?: string; // 이름 앞의 작은 글씨 (시도 등)
  sublabel?: string;
  tag?: string;
  value: number;
  valueText: string;
  shareText: string;
  muted?: boolean; // 강조하지 않는 항목 (예: 김천시 자체)
  tooltip: TooltipRow[];
}

/** 가로 막대 목록. 이름이 길고 항목이 많은 순위·구성에 쓴다. */
export function BarList({ items, label }: { items: BarItem[]; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className="barlist-wrap">
      <ol className="barlist" aria-label={label}>
        {items.map((it, i) => (
          <li
            key={it.key}
            className="barlist-row"
            data-active={active === i}
            tabIndex={0}
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          >
            {it.rank !== undefined && <span className="barlist-rank">{String(it.rank).padStart(2, '0')}</span>}
            <span className="barlist-label">
              {it.prefix && <span className="barlist-sub">{it.prefix}</span>}
              <span className="barlist-name">{it.label}</span>
              {it.sublabel && <span className="barlist-sub">{it.sublabel}</span>}
              {it.tag && <span className="tag">{it.tag}</span>}
            </span>
            <span className="barlist-track" aria-hidden="true">
              <span
                className={it.muted ? 'barlist-bar is-muted' : 'barlist-bar'}
                style={{ width: `${Math.max(it.value > 0 ? 0.6 : 0, (it.value / max) * 100)}%` }}
              />
            </span>
            <span className="barlist-value">{it.valueText}</span>
            <span className="barlist-share">{it.shareText}</span>
            {active === i && (
              <span className="tooltip barlist-tooltip" role="presentation">
                <span className="tooltip-title">{it.prefix ? `${it.prefix} ${it.label}` : it.label}</span>
                {it.tooltip.map((r) => (
                  <span className="tooltip-row" key={r.label}>
                    <strong>{r.value}</strong>
                    <span>{r.label}</span>
                  </span>
                ))}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
