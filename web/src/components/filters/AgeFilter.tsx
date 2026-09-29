import { ageLabel, describeAges } from '../../data/filters';
import { useDataset } from '../../state/DataProvider';
import { useFilters } from '../../state/FilterProvider';
import { Icon } from '../ui/Icon';
import { FilterPopover, OptionRow } from './Popover';

/** 원본 16개 연령대를 생애단계로 묶어 고른다. 아무것도 안 고르면 전체 연령. */
export function AgeFilter() {
  const ds = useDataset();
  const { filters, update } = useFilters();
  const all = ds.ages.map((a) => a.code);
  const chosen = new Set(filters.ages);
  const isAll = chosen.size === 0;

  // 순서를 원본 연령대 순서로 맞추고, 전부 고르면 "전체"(빈 배열)로 되돌린다
  const commit = (next: Set<string>) => {
    const ordered = all.filter((c) => next.has(c));
    update({ ages: ordered.length === all.length ? [] : ordered });
  };

  const toggleAge = (code: string) => {
    if (isAll) return commit(new Set([code]));
    const next = new Set(chosen);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    commit(next);
  };

  const toggleStage = (codes: string[]) => {
    const full = !isAll && codes.every((c) => chosen.has(c));
    if (isAll) return commit(new Set(codes));
    const next = new Set(chosen);
    codes.forEach((c) => (full ? next.delete(c) : next.add(c)));
    commit(next);
  };

  return (
    <FilterPopover eyebrow="Age" label="연령" value={describeAges(ds, filters.ages)} active={!isAll} width={380}>
      {(close) => (
        <>
          <div className="option-list" role="radiogroup" aria-label="전체 연령">
            <OptionRow selected={isAll} label="전체 연령" hint="16개 연령대" onSelect={() => update({ ages: [] })} />
          </div>
          <div className="age-groups">
            {ds.lifeStages.map((stage) => {
              const codes = ds.ages.filter((a) => a.lifeStage === stage.name).map((a) => a.code);
              const count = isAll ? 0 : codes.filter((c) => chosen.has(c)).length;
              const state = count === 0 ? 'none' : count === codes.length ? 'all' : 'some';
              return (
                <fieldset className="age-group" key={stage.name}>
                  <legend className="sr-only">{stage.name}</legend>
                  <button
                    type="button"
                    className="age-stage"
                    aria-pressed={state === 'all' ? true : state === 'some' ? 'mixed' : false}
                    onClick={() => toggleStage(codes)}
                  >
                    <span className="checkbox" data-state={state} aria-hidden="true">
                      {state === 'all' && <Icon name="check" size={12} />}
                    </span>
                    <span className="age-stage-name">{stage.name}</span>
                    <span className="age-stage-range">{stage.range}</span>
                  </button>
                  <div className="chips">
                    {codes.map((c) => (
                      <button
                        type="button"
                        key={c}
                        className="chip"
                        aria-pressed={!isAll && chosen.has(c)}
                        onClick={() => toggleAge(c)}
                      >
                        {ageLabel(c)}
                      </button>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
          <div className="popover-foot popover-actions">
            <p className="popover-foot-note">00~09세는 10년, 나머지는 5년 구간입니다.</p>
            <button type="button" className="button button-primary" onClick={close}>
              완료
            </button>
          </div>
        </>
      )}
    </FilterPopover>
  );
}
