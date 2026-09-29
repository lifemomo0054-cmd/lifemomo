import { useState } from 'react';
import { activeFilterCount, describeAges, describePeriod, describeRegion } from '../../data/filters';
import { fmtInt } from '../../data/format';
import { useDataset } from '../../state/DataProvider';
import { useFilters } from '../../state/FilterProvider';
import { Icon } from '../ui/Icon';
import { AgeFilter } from './AgeFilter';
import { GenderFilter } from './GenderFilter';
import { PeriodFilter } from './PeriodFilter';
import { RegionFilter } from './RegionFilter';

/** 모든 화면에 함께 걸리는 조건. 바꾸면 모든 KPI·그래프가 같은 조건으로 다시 계산된다. */
export function FilterBar() {
  const ds = useDataset();
  const { filters, reset, summary } = useFilters();
  const [expanded, setExpanded] = useState(false);
  const count = activeFilterCount(ds, filters);
  const gender = filters.gender === 'all' ? '전체 성별' : ds.genders.find((g) => g.code === filters.gender)?.label;

  return (
    <section className="filterbar" aria-label="분석 조건" data-expanded={expanded}>
      <div className="filterbar-compact">
        <button
          type="button"
          className="button filterbar-toggle"
          aria-expanded={expanded}
          aria-controls="filterbar-fields"
          onClick={() => setExpanded((e) => !e)}
        >
          <Icon name="filter" />
          필터{count > 0 && <span className="count-badge">{count}</span>}
        </button>
        <p className="filterbar-summary">
          {[describePeriod(ds, filters), gender, describeAges(ds, filters.ages), describeRegion(ds, filters.region)].join(' · ')}
        </p>
      </div>

      <div className="filterbar-fields" id="filterbar-fields">
        <PeriodFilter />
        <GenderFilter />
        <AgeFilter />
        <RegionFilter />
      </div>

      <div className="filterbar-meta">
        <p className="filterbar-count" aria-live="polite">
          <span className="mono">{fmtInt(summary.rowCount)}</span>
          <span className="filterbar-count-of"> / {fmtInt(ds.rows.n)}행</span>
          <span className="filterbar-count-sep" aria-hidden="true">·</span>
          데이터 <span className="mono">{summary.dataDays}</span>일
        </p>
        <button type="button" className="button button-ghost" onClick={reset} disabled={count === 0}>
          <Icon name="reset" />
          초기화
        </button>
      </div>
    </section>
  );
}
