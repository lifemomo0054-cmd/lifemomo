import type { ReactNode } from 'react';
import { describeAges, describePeriod, describeRegion } from '../../data/filters';
import { useDataset } from '../../state/DataProvider';
import { useFilters } from '../../state/FilterProvider';

/** 현재 필터를 사람이 읽는 말로 (기간 · 성별 · 연령 · 거주지역) */
export function useConditionLabels(): string[] {
  const ds = useDataset();
  const { filters } = useFilters();
  const gender = filters.gender === 'all' ? '전체 성별' : ds.genders.find((g) => g.code === filters.gender)!.label;
  return [describePeriod(ds, filters), gender, describeAges(ds, filters.ages), describeRegion(ds, filters.region)];
}

export function PageHeader({
  no,
  en,
  title,
  lead,
  aside,
}: {
  no: string;
  en: string;
  title: string;
  lead: ReactNode;
  aside?: ReactNode;
}) {
  const condition = useConditionLabels();
  return (
    <header className={aside ? 'page-head' : 'page-head page-head-simple'}>
      <div className="page-head-main">
        <p className="eyebrow">
          {no} — {en}
        </p>
        <h1 className="page-title">{title}</h1>
        <p className="page-lead">{lead}</p>
        <p className="condition" aria-label="현재 조건">
          {condition.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </p>
      </div>
      {aside}
    </header>
  );
}

/** 패널 안의 작은 전환 버튼 (예: 일 / 주 / 월) */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="view-toggle" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
