import { useId, useState, type ReactNode } from 'react';

export interface TableSpec {
  columns: { label: string; numeric?: boolean }[];
  rows: string[][];
}

interface Props {
  fig: string;
  title: string;
  subtitle?: ReactNode;
  legend?: ReactNode;
  tools?: ReactNode; // 머리 오른쪽 도구 (예: 일/주/월 전환)
  table?: TableSpec;
  foot?: ReactNode;
  empty?: boolean;
  className?: string;
  children: ReactNode;
}

/** 그래프 한 장. 모든 그래프는 같은 값을 표로도 볼 수 있다. */
export function Panel({ fig, title, subtitle, legend, tools, table, foot, empty, className, children }: Props) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const id = useId();

  return (
    <section className={`panel ${className ?? ''}`} aria-labelledby={`${id}-title`}>
      <header className="panel-head">
        <div className="panel-heading">
          <p className="panel-fig">Fig. {fig}</p>
          <h2 className="panel-title" id={`${id}-title`}>
            {title}
          </h2>
          {subtitle && <p className="panel-sub">{subtitle}</p>}
        </div>
        {(tools || (table && !empty)) && (
          <div className="panel-tools">
            {!empty && tools}
            {table && !empty && (
              <div className="view-toggle" role="group" aria-label={`${title} 보기 방식`}>
                <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
                  차트
                </button>
                <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>
                  표
                </button>
              </div>
            )}
          </div>
        )}
      </header>
      {empty ? (
        <p className="panel-empty">선택한 조건에 맞는 데이터가 없습니다.</p>
      ) : view === 'table' && table ? (
        <DataTable caption={title} spec={table} />
      ) : (
        <>
          {legend}
          <div className="panel-body">{children}</div>
        </>
      )}
      {foot && <footer className="panel-foot">{foot}</footer>}
    </section>
  );
}

export function DataTable({ caption, spec }: { caption: string; spec: TableSpec }) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={`${caption} 표`}>
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {spec.columns.map((c) => (
              <th key={c.label} scope="col" className={c.numeric ? 'num' : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td key={i} className={spec.columns[i]?.numeric ? 'num' : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
