import { describeAges, describePeriod, describeRegion } from '../data/filters';
import { fmtInt } from '../data/format';
import type { NavItem } from '../nav';
import { useDataset } from '../state/DataProvider';
import { useFilters } from '../state/FilterProvider';

/** 아직 만들지 않은 화면. 필터가 이 화면에도 그대로 걸려 있다는 것을 보여 준다. */
export function ComingSoon({ item }: { item: NavItem }) {
  const ds = useDataset();
  const { filters, summary } = useFilters();
  const gender = filters.gender === 'all' ? '전체 성별' : ds.genders.find((g) => g.code === filters.gender)?.label;

  return (
    <div className="soon">
      <header className="page-head page-head-simple">
        <div className="page-head-main">
          <p className="eyebrow">
            {item.no} — {item.en}
          </p>
          <h1 className="page-title">{item.label}</h1>
          <p className="page-lead">{item.summary}</p>
        </div>
      </header>

      <div className="grid">
        <section className="panel span-7 soon-card">
          <p className="status-pill" data-kind="soon">
            <span aria-hidden="true" />
            준비 중
          </p>
          <h2 className="soon-title">이 화면은 다음 단계에서 만듭니다.</h2>
          <p className="soon-desc">들어갈 내용</p>
          <ol className="soon-list">
            {item.planned.map((p, i) => (
              <li key={p}>
                <span className="mono">{String(i + 1).padStart(2, '0')}</span>
                {p}
              </li>
            ))}
          </ol>
          {item.needs && <p className="soon-needs">필요한 것 · {item.needs}</p>}
        </section>

        <section className="panel span-5 soon-card">
          <p className="panel-fig">Filters</p>
          <h2 className="panel-title">이 화면에도 같은 조건이 걸려 있습니다</h2>
          <dl className="soon-filters">
            <div>
              <dt>기간</dt>
              <dd>{describePeriod(ds, filters)}</dd>
            </div>
            <div>
              <dt>성별</dt>
              <dd>{gender}</dd>
            </div>
            <div>
              <dt>연령</dt>
              <dd>{describeAges(ds, filters.ages)}</dd>
            </div>
            <div>
              <dt>거주지역</dt>
              <dd>{describeRegion(ds, filters.region)}</dd>
            </div>
            <div>
              <dt>해당 행</dt>
              <dd className="mono">{fmtInt(summary.rowCount)}</dd>
            </div>
            <div>
              <dt>총 생활인구</dt>
              <dd className="mono">{fmtInt(summary.total)}명</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
