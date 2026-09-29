import { createContext, useCallback, useContext, useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { summarize, type Summary } from '../data/engine';
import { defaultFilters, type Filters } from '../data/filters';
import { useDataset } from './DataProvider';

interface FilterContextValue {
  filters: Filters;
  update: (patch: Partial<Filters>) => void;
  reset: () => void;
  /** 모든 KPI·차트가 함께 쓰는 집계 결과 */
  summary: Summary;
  /** 새 필터로 다시 계산하는 동안 true (이전 화면을 흐리게 유지) */
  stale: boolean;
}

const FilterContext = createContext<FilterContextValue | null>(null);

export function FilterProvider({ children }: { children: ReactNode }) {
  const ds = useDataset();
  const [filters, setFilters] = useState<Filters>(() => defaultFilters(ds));
  const deferred = useDeferredValue(filters);
  const summary = useMemo(() => summarize(ds, deferred), [ds, deferred]);

  const update = useCallback((patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch })), []);
  const reset = useCallback(() => setFilters(defaultFilters(ds)), [ds]);

  const value = useMemo(
    () => ({ filters, update, reset, summary, stale: deferred !== filters }),
    [filters, update, reset, summary, deferred],
  );
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters(): FilterContextValue {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('FilterProvider 안에서만 쓸 수 있습니다.');
  return ctx;
}
