import type { ReactNode } from 'react';

export interface TooltipRow {
  label: string;
  value: string;
  swatch?: 'line' | 'rect';
  color?: string;
}

/** 값이 먼저, 이름이 뒤에. 계열 표시는 짧은 선(또는 막대 조각). */
export function Tooltip({
  x,
  y,
  width,
  title,
  rows,
  note,
}: {
  x: number;
  y: number;
  width: number;
  title: ReactNode;
  rows: TooltipRow[];
  note?: ReactNode;
}) {
  const flip = x > width - 200;
  return (
    <div
      className="tooltip"
      role="presentation"
      style={{ left: flip ? undefined : x + 12, right: flip ? width - x + 12 : undefined, top: Math.max(0, y) }}
    >
      <p className="tooltip-title">{title}</p>
      {rows.map((r) => (
        <p className="tooltip-row" key={r.label}>
          {r.color && <span className={`key key-${r.swatch ?? 'line'}`} style={{ background: r.color }} aria-hidden="true" />}
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </p>
      ))}
      {note && <p className="tooltip-note">{note}</p>}
    </div>
  );
}
