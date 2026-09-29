import { useMemo, useState } from 'react';
import { rankRegions, summarize } from '../../data/engine';
import { defaultFilters, describeRegion, sameScope, type RegionScope } from '../../data/filters';
import { useDataset } from '../../state/DataProvider';
import { useFilters } from '../../state/FilterProvider';
import { Icon } from '../ui/Icon';
import { FilterPopover, OptionRow } from './Popover';

const MAX_RESULTS = 40;

export function RegionFilter() {
  const ds = useDataset();
  const { filters, update } = useFilters();
  const [query, setQuery] = useState('');

  // 빠른 선택용: 전체 기간·전체 조건 기준 상위 거주지 (체류지 자체 제외)
  const topRegions = useMemo(
    () => rankRegions(ds, summarize(ds, defaultFilters(ds))).filter((r) => !r.isStay).slice(0, 6),
    [ds],
  );
  const sidoShort = useMemo(() => new Map(ds.sidos.map((s) => [s.code, s.short])), [ds]);

  const q = query.trim().replace(/\s+/g, ' ');
  const results = useMemo(() => {
    if (!q) return [];
    return ds.regions
      .filter((r) => r.full.includes(q) || r.name.includes(q) || `${sidoShort.get(r.sido)} ${r.name}`.includes(q) || r.code.startsWith(q))
      .slice(0, MAX_RESULTS);
  }, [ds, q, sidoShort]);

  const is = (scope: RegionScope) => sameScope(filters.region, scope);

  return (
    <FilterPopover
      eyebrow="Origin"
      label="거주지역"
      value={describeRegion(ds, filters.region)}
      active={filters.region.kind !== 'all'}
      width={400}
    >
      {(close) => {
        const pick = (region: RegionScope) => {
          update({ region });
          setQuery('');
          close();
        };
        return (
          <>
            <div className="search">
              <Icon name="search" className="search-icon" />
              <input
                type="search"
                value={query}
                placeholder={`시군구 검색 (예: ${topRegions.slice(0, 2).map((r) => r.name).join(', ')})`}
                aria-label="거주 시군구 검색"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {q ? (
              <div className="option-list option-scroll" role="radiogroup" aria-label="검색 결과">
                {results.length === 0 && <p className="empty-note">‘{q}’에 맞는 시군구가 없습니다.</p>}
                {results.map((r) => (
                  <OptionRow
                    key={r.code}
                    selected={is({ kind: 'region', code: r.code })}
                    label={r.full}
                    hint={r.zone}
                    onSelect={() => pick({ kind: 'region', code: r.code })}
                  />
                ))}
              </div>
            ) : (
              <div className="option-scroll">
                <div className="option-list" role="radiogroup" aria-label="빠른 선택">
                  <OptionRow selected={is({ kind: 'all' })} label="전체 거주지" hint={`${ds.regions.length}개 시군구`} onSelect={() => pick({ kind: 'all' })} />
                  <OptionRow
                    selected={is({ kind: 'external' })}
                    label="외부 유입만"
                    hint={`${ds.stayName} 거주자 제외`}
                    onSelect={() => pick({ kind: 'external' })}
                  />
                  <OptionRow
                    selected={is({ kind: 'region', code: ds.stayRegion.code })}
                    label={`${ds.stayName} 자체`}
                    hint="거주지 = 체류지"
                    onSelect={() => pick({ kind: 'region', code: ds.stayRegion.code })}
                  />
                </div>

                <p className="popover-section">{ds.stayName} 기준 권역</p>
                <div className="chips chips-pad">
                  {ds.zones
                    .filter((z) => z !== ds.regions[ds.stayRegionIndex].zone)
                    .map((z) => (
                      <button key={z} type="button" className="chip" aria-pressed={is({ kind: 'zone', zone: z })} onClick={() => pick({ kind: 'zone', zone: z })}>
                        {z}
                      </button>
                    ))}
                </div>

                <p className="popover-section">주요 거주지</p>
                <div className="chips chips-pad">
                  {topRegions.map((r) => (
                    <button
                      key={r.code}
                      type="button"
                      className="chip"
                      aria-pressed={is({ kind: 'region', code: r.code })}
                      onClick={() => pick({ kind: 'region', code: r.code })}
                    >
                      {r.sidoShort} {r.name}
                    </button>
                  ))}
                </div>

                <p className="popover-section">시도</p>
                <div className="chips chips-pad chips-grid">
                  {ds.sidos.map((s) => (
                    <button
                      key={s.code}
                      type="button"
                      className="chip"
                      aria-pressed={is({ kind: 'sido', sido: s.code })}
                      title={s.name}
                      onClick={() => pick({ kind: 'sido', sido: s.code })}
                    >
                      {s.short}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        );
      }}
    </FilterPopover>
  );
}
