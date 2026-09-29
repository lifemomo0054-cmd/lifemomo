import { useDeferredValue, useMemo, useState } from 'react';
import { Icon } from '../components/ui/Icon';
import { StatTile } from '../components/ui/Metrics';
import { PageHeader } from '../components/ui/PageHeader';
import { shortDay } from '../data/dates';
import { DIMS, filterRows, pivot, rowsCsv, rowView, toCsv, type Dim, type PivotRow } from '../data/explore';
import { fmtInt, fmtNum, fmtPct } from '../data/format';
import type { Dataset } from '../data/types';
import { useDataset } from '../state/DataProvider';
import { useFilters } from '../state/FilterProvider';

const PAGE_SIZE = 50;
const PIVOT_PAGE = 30;

type RowSort = 'date' | 'region' | 'gender' | 'age' | 'population';
type PivotSort = 'label' | 'rows' | 'sum';
type Dir = 'asc' | 'desc';

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sortRows(ds: Dataset, idx: Int32Array, key: RowSort, dir: Dir): Int32Array {
  const { rows } = ds;
  const sign = dir === 'asc' ? 1 : -1;
  const value = (i: number): number | string => {
    switch (key) {
      case 'date':
        return rows.date[i];
      case 'region':
        return ds.regions[rows.region[i]].full;
      case 'gender':
        return rows.gender[i];
      case 'age':
        return rows.age[i];
      case 'population':
        return rows.pop100[i];
    }
  };
  // 같은 값이면 날짜 → 거주지 → 성별 → 연령대 순으로 (결과가 매번 같도록)
  const tie = (a: number, b: number) =>
    rows.date[a] - rows.date[b] || rows.region[a] - rows.region[b] || rows.gender[a] - rows.gender[b] || rows.age[a] - rows.age[b];
  return Int32Array.from(idx).sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const c = typeof va === 'string' ? va.localeCompare(vb as string, 'ko') : (va as number) - (vb as number);
    return c * sign || tie(a, b);
  });
}

function SortButton<K extends string>({
  label,
  k,
  sort,
  dir,
  onSort,
  numeric,
}: {
  label: string;
  k: K;
  sort: K;
  dir: Dir;
  onSort: (k: K) => void;
  numeric?: boolean;
}) {
  const active = sort === k;
  return (
    <th scope="col" className={numeric ? 'num' : undefined} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="sort-button" onClick={() => onSort(k)}>
        {label}
        <span className="sort-mark" aria-hidden="true">
          {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}

export function Explorer() {
  const ds = useDataset();
  const { filters, summary: s } = useFilters();

  // ── 행 목록 ────────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim());
  const [hideZero, setHideZero] = useState(false);
  const [sort, setSort] = useState<RowSort>('date');
  const [dir, setDir] = useState<Dir>('asc');
  const [page, setPage] = useState(0);

  const base = useMemo(() => filterRows(ds, filters), [ds, filters]);
  const visible = useMemo(() => {
    const q = deferredQuery;
    const keep = base.filter((i) => {
      if (hideZero && ds.rows.pop100[i] === 0) return false;
      if (!q) return true;
      const r = ds.regions[ds.rows.region[i]];
      return r.full.includes(q) || r.code.startsWith(q);
    });
    return sortRows(ds, keep, sort, dir);
  }, [ds, base, deferredQuery, hideZero, sort, dir]);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = Array.from(visible.subarray(current * PAGE_SIZE, (current + 1) * PAGE_SIZE), (i) => rowView(ds, i));

  const onSort = (k: RowSort) => {
    setDir(sort === k ? (dir === 'asc' ? 'desc' : 'asc') : k === 'population' ? 'desc' : 'asc');
    setSort(k);
    setPage(0);
  };

  // ── 피벗 ──────────────────────────────────────────────────────────────────
  const [dim1, setDim1] = useState<Dim>('sigungu');
  const [dim2, setDim2] = useState<Dim | ''>('');
  const [psort, setPsort] = useState<PivotSort>('sum');
  const [pdir, setPdir] = useState<Dir>('desc');
  const [plimit, setPlimit] = useState(PIVOT_PAGE);
  const dims: Dim[] = dim2 && dim2 !== dim1 ? [dim1, dim2] : [dim1];
  const grouped = useMemo(() => {
    const out = pivot(ds, base, dims);
    const sign = pdir === 'asc' ? 1 : -1;
    const byOrder = (a: PivotRow, b: PivotRow) => a.order.reduce((c, v, i) => c || v - b.order[i], 0);
    return out.sort((a, b) => (psort === 'label' ? byOrder(a, b) : psort === 'rows' ? a.rows - b.rows : a.sum - b.sum) * sign || byOrder(a, b));
  }, [ds, base, dims.join(), psort, pdir]); // dims 는 매번 새 배열이라 join 한 값으로 비교
  const maxSum = Math.max(1, ...grouped.map((g) => g.sum));
  const onPsort = (k: PivotSort) => {
    setPdir(psort === k ? (pdir === 'asc' ? 'desc' : 'asc') : k === 'label' ? 'asc' : 'desc');
    setPsort(k);
  };
  const dimLabel = (d: Dim) => DIMS.find((x) => x.value === d)!.label;

  const zeroRows = base.reduce((n, i) => n + (ds.rows.pop100[i] === 0 ? 1 : 0), 0);
  const cappedRows = s.cappedRows;
  const selfRows = base.reduce((n, i) => n + (ds.rows.region[i] === ds.stayRegionIndex ? 1 : 0), 0);

  return (
    <div className="page-explorer">
      <PageHeader
        no="07"
        en="Explorer"
        title="데이터 탐색기"
        lead="위쪽 조건에 걸린 원본 행을 그대로 봅니다. 원하는 기준으로 묶어 합계를 내거나, 행 목록을 정렬·검색하고 CSV로 내려받을 수 있습니다."
      />

      <section className="kpi-row" aria-label="데이터 품질">
        <StatTile label="해당 행" value={`${fmtInt(base.length)}행`} sub={`원본 ${fmtInt(ds.rows.n)}행의 ${fmtPct(base.length / ds.rows.n)}`} />
        <StatTile label="생활인구가 0인 행" value={`${fmtInt(zeroRows)}행`} sub={`해당 행의 ${fmtPct(base.length ? zeroRows / base.length : null)} · 0이 아닌 값은 모두 ${fmtNum(ds.minPositive100 / 100)} 이상`} />
        <StatTile label="상한값 행" value={`${fmtInt(cappedRows)}행`} sub={`생활인구가 ${fmtNum(ds.cap100 / 100)}로 같은 행`} />
        <StatTile label={`${ds.stayName} 자체 행`} value={`${fmtInt(selfRows)}행`} sub="거주지 = 체류지" />
      </section>

      <div className="grid">
        <section className="panel span-12" aria-labelledby="pivot-title">
          <header className="panel-head">
            <div className="panel-heading">
              <p className="panel-fig">Fig. 01 · Pivot</p>
              <h2 className="panel-title" id="pivot-title">
                기준별로 묶기
              </h2>
              <p className="panel-sub">기준을 하나 또는 두 개 골라 행 수와 생활인구 합계를 냅니다. 머리글을 누르면 정렬합니다.</p>
            </div>
            <div className="panel-tools">
              <label className="select">
                <span>기준 1</span>
                <select
                  value={dim1}
                  onChange={(e) => {
                    setDim1(e.target.value as Dim);
                    setPlimit(PIVOT_PAGE);
                  }}
                >
                  {DIMS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.group} · {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="select">
                <span>기준 2</span>
                <select
                  value={dim2}
                  onChange={(e) => {
                    setDim2(e.target.value as Dim | '');
                    setPlimit(PIVOT_PAGE);
                  }}
                >
                  <option value="">없음</option>
                  {DIMS.filter((d) => d.value !== dim1).map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.group} · {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button"
                disabled={grouped.length === 0}
                onClick={() =>
                  download(
                    `LPL_${ds.stayRegion.code}_pivot_${dims.join('-')}_synthetic-data.csv`,
                    toCsv(
                      [...dims.map(dimLabel), '행 수', '0이 아닌 행 수', '생활인구 합계', '비중'],
                      grouped.map((g) => [...g.labels, g.rows, g.nonzero, Number(g.sum.toFixed(2)), g.share === null ? '' : Number(g.share.toFixed(6))]),
                    ),
                  )
                }
              >
                <Icon name="download" />
                CSV
              </button>
            </div>
          </header>
          {grouped.length === 0 ? (
            <p className="panel-empty">선택한 조건에 맞는 데이터가 없습니다.</p>
          ) : (
            <>
              <div className="table-wrap table-tall" tabIndex={0} role="region" aria-label="기준별 묶음 표">
                <table className="data-table">
                  <caption className="sr-only">기준별 묶음</caption>
                  <thead>
                    <tr>
                      {dims.map((d, i) =>
                        i === 0 ? (
                          <SortButton key={d} label={dimLabel(d)} k="label" sort={psort} dir={pdir} onSort={onPsort} />
                        ) : (
                          <th key={d} scope="col">
                            {dimLabel(d)}
                          </th>
                        ),
                      )}
                      <SortButton label="행 수" k="rows" sort={psort} dir={pdir} onSort={onPsort} numeric />
                      <th scope="col" className="num">
                        0이 아닌 행
                      </th>
                      <SortButton label="생활인구 (명)" k="sum" sort={psort} dir={pdir} onSort={onPsort} numeric />
                      <th scope="col" className="num">
                        비중
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.slice(0, plimit).map((g) => (
                      <tr key={g.key}>
                        {g.labels.map((l, i) => (
                          <td key={i}>{dims[i] === 'date' ? shortDay(l, true) : l}</td>
                        ))}
                        <td className="num">{fmtInt(g.rows)}</td>
                        <td className="num">{fmtInt(g.nonzero)}</td>
                        <td className="num databar-cell">
                          <span className="databar-track" aria-hidden="true">
                            <span className="databar" style={{ width: `${(g.sum / maxSum) * 100}%` }} />
                          </span>
                          <span className="databar-value">{fmtInt(g.sum)}</span>
                        </td>
                        <td className="num">{fmtPct(g.share)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-foot">
                <span>
                  {fmtInt(grouped.length)}개 중 {fmtInt(Math.min(plimit, grouped.length))}개 표시 · 합계 {fmtInt(s.total)}명
                </span>
                {grouped.length > plimit && (
                  <button type="button" className="button" onClick={() => setPlimit((n) => n + PIVOT_PAGE * 2)}>
                    더 보기
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        <section className="panel span-12" aria-labelledby="rows-title">
          <header className="panel-head">
            <div className="panel-heading">
              <p className="panel-fig">Fig. 02 · Rows</p>
              <h2 className="panel-title" id="rows-title">
                원본 행 목록
              </h2>
              <p className="panel-sub">
                전처리한 원본 행을 그대로 보여 줍니다. ‘표시’ 칸은 0 · 상한값 · 체류지 자체 행을 알려 줍니다.
              </p>
            </div>
            <div className="panel-tools">
              <div className="search search-inline search-compact">
                <Icon name="search" className="search-icon" />
                <input
                  type="search"
                  value={query}
                  placeholder="거주지 이름·코드"
                  aria-label="거주지 이름 또는 코드로 찾기"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                />
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={hideZero}
                  onChange={(e) => {
                    setHideZero(e.target.checked);
                    setPage(0);
                  }}
                />
                0인 행 숨기기
              </label>
              <button
                type="button"
                className="button"
                disabled={visible.length === 0}
                onClick={() => download(`LPL_${ds.stayRegion.code}_rows_${visible.length}_synthetic-data.csv`, rowsCsv(ds, visible))}
              >
                <Icon name="download" />
                CSV ({fmtInt(visible.length)}행)
              </button>
            </div>
          </header>
          {visible.length === 0 ? (
            <p className="panel-empty">조건에 맞는 행이 없습니다.</p>
          ) : (
            <>
              <div className="table-wrap table-free" tabIndex={0} role="region" aria-label="원본 행 목록">
                <table className="data-table">
                  <caption className="sr-only">원본 행 목록</caption>
                  <thead>
                    <tr>
                      <SortButton label="날짜" k="date" sort={sort} dir={dir} onSort={onSort} />
                      <SortButton label="거주지" k="region" sort={sort} dir={dir} onSort={onSort} />
                      <th scope="col">권역</th>
                      <SortButton label="성별" k="gender" sort={sort} dir={dir} onSort={onSort} />
                      <SortButton label="연령대" k="age" sort={sort} dir={dir} onSort={onSort} />
                      <SortButton label="생활인구" k="population" sort={sort} dir={dir} onSort={onSort} numeric />
                      <th scope="col">표시</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.index}>
                        <td>{shortDay(r.date, true)}</td>
                        <td>
                          {r.region} <span className="muted mono">{r.regionCode}</span>
                        </td>
                        <td>{r.zone}</td>
                        <td>{r.gender}</td>
                        <td>{r.age}</td>
                        <td className="num">{fmtNum(r.population)}</td>
                        <td>
                          {r.flags.map((f) => (
                            <span key={f} className="tag">
                              {f}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <nav className="pager" aria-label="행 목록 페이지">
                <button type="button" className="button" disabled={current === 0} onClick={() => setPage(0)}>
                  처음
                </button>
                <button type="button" className="button" disabled={current === 0} onClick={() => setPage(current - 1)}>
                  이전
                </button>
                <span className="pager-status">
                  {fmtInt(current + 1)} / {fmtInt(pages)}쪽 · {fmtInt(current * PAGE_SIZE + 1)}–{fmtInt(Math.min(visible.length, (current + 1) * PAGE_SIZE))}행 / {fmtInt(visible.length)}행
                </span>
                <button type="button" className="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                  다음
                </button>
                <button type="button" className="button" disabled={current >= pages - 1} onClick={() => setPage(pages - 1)}>
                  끝
                </button>
              </nav>
            </>
          )}
          <footer className="panel-foot">
            CSV 파일 이름에는 합성데이터 표시(synthetic-data)가 붙고, 엑셀에서 한글이 깨지지 않도록 UTF-8(BOM)으로 저장합니다. 파일 이름은
            브라우저 호환을 위해 영문으로 짓습니다.
          </footer>
        </section>
      </div>
    </div>
  );
}
