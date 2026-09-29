export interface LegendItem {
  label: string;
  color: string;
  kind: 'line' | 'rect' | 'band';
}

/** 범례의 표시는 그래프의 표시와 같은 모양 (선은 선, 막대는 사각형) */
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="legend">
      {items.map((it) => (
        <li key={it.label}>
          <span className={`key key-${it.kind}`} style={{ background: it.color }} aria-hidden="true" />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
