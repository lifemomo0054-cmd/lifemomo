import { useState } from 'react';
import { fmtInt, fmtPct } from '../../data/format';
import type { TooltipRow } from './Tooltip';

export interface PyramidSpec {
  key: string;
  label: string;
  left: number;
  right: number;
  tooltip: TooltipRow[];
}

/**
 * 인구 피라미드: 가운데 연령대, 왼쪽·오른쪽으로 두 성별. 위가 나이 많은 쪽.
 * 막대는 가운데 축(기준선)에서 바깥으로 자라고, 바깥 끝만 둥글다.
 */
export function Pyramid({
  rows,
  leftLabel,
  rightLabel,
  leftColor,
  rightColor,
  total,
  label,
}: {
  rows: PyramidSpec[]; // 젊은 쪽부터
  leftLabel: string;
  rightLabel: string;
  leftColor: string;
  rightColor: string;
  total: number;
  label: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(1, ...rows.flatMap((r) => [r.left, r.right]));
  const ordered = [...rows].reverse();

  return (
    <div className="pyramid" role="img" aria-label={label}>
      <div className="pyramid-head" aria-hidden="true">
        <span>{leftLabel}</span>
        <span />
        <span>{rightLabel}</span>
      </div>
      <ul>
        {ordered.map((r) => (
          <li
            key={r.key}
            className="pyramid-row"
            data-active={active === r.key}
            tabIndex={0}
            aria-label={`${r.label} ${leftLabel} ${fmtInt(r.left)}, ${rightLabel} ${fmtInt(r.right)}`}
            onPointerEnter={() => setActive(r.key)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(r.key)}
            onBlur={() => setActive(null)}
          >
            <span className="pyramid-side pyramid-left">
              <span className="pyramid-value">{total > 0 ? fmtPct(r.left / total) : ''}</span>
              <span className="pyramid-bar" style={{ width: `${(r.left / max) * 100}%`, background: leftColor }} />
            </span>
            <span className="pyramid-label">{r.label}</span>
            <span className="pyramid-side pyramid-right">
              <span className="pyramid-bar" style={{ width: `${(r.right / max) * 100}%`, background: rightColor }} />
              <span className="pyramid-value">{total > 0 ? fmtPct(r.right / total) : ''}</span>
            </span>
            {active === r.key && (
              <span className="tooltip pyramid-tooltip" role="presentation">
                <span className="tooltip-title">{r.label}</span>
                {r.tooltip.map((t) => (
                  <span className="tooltip-row" key={t.label}>
                    {t.color && <span className="key key-rect" style={{ background: t.color }} aria-hidden="true" />}
                    <strong>{t.value}</strong>
                    <span>{t.label}</span>
                  </span>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="pyramid-note">막대 옆 숫자: 전체 대비 비중</p>
    </div>
  );
}

export interface RatioSpec {
  key: string;
  label: string;
  ratio: number | null; // 기준 100
  tooltip: TooltipRow[];
}

/**
 * 성비(여성 100명당 남성) 막대. 100을 가운데 두고 로그 눈금으로 양쪽에 그린다.
 * 오른쪽(남성이 많음)은 rightColor, 왼쪽(여성이 많음)은 leftColor.
 */
export function RatioBars({
  rows,
  leftColor,
  rightColor,
  leftNote,
  rightNote,
}: {
  rows: RatioSpec[];
  leftColor: string;
  rightColor: string;
  leftNote: string;
  rightNote: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const logs = rows.map((r) => (r.ratio && r.ratio > 0 ? Math.log2(r.ratio / 100) : 0));
  const span = Math.max(1, ...logs.map(Math.abs));

  return (
    <div className="ratio">
      <div className="ratio-head" aria-hidden="true">
        <span>← {leftNote}</span>
        <span>100</span>
        <span>{rightNote} →</span>
      </div>
      <ul>
        {rows.map((r, i) => {
          const w = (Math.abs(logs[i]) / span) * 50;
          const right = logs[i] >= 0;
          return (
            <li
              key={r.key}
              className="ratio-row"
              data-active={active === r.key}
              tabIndex={0}
              aria-label={`${r.label} 성비 ${r.ratio === null ? '계산 불가' : r.ratio.toFixed(1)}`}
              onPointerEnter={() => setActive(r.key)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(r.key)}
              onBlur={() => setActive(null)}
            >
              <span className="ratio-label">{r.label}</span>
              <span className="ratio-track">
                <span className="ratio-mid" aria-hidden="true" />
                {r.ratio !== null && (
                  <span
                    className={right ? 'ratio-bar ratio-bar-right' : 'ratio-bar ratio-bar-left'}
                    style={{ width: `${w}%`, [right ? 'left' : 'right']: '50%', background: right ? rightColor : leftColor }}
                  />
                )}
              </span>
              <span className="ratio-value">{r.ratio === null ? '—' : r.ratio.toFixed(1)}</span>
              {active === r.key && (
                <span className="tooltip ratio-tooltip" role="presentation">
                  <span className="tooltip-title">{r.label}</span>
                  {r.tooltip.map((t) => (
                    <span className="tooltip-row" key={t.label}>
                      <strong>{t.value}</strong>
                      <span>{t.label}</span>
                    </span>
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
