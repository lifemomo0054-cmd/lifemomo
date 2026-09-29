import { useState } from 'react';
import { dotDay } from '../../data/dates';
import { describePeriod, matchPreset, periodPresets } from '../../data/filters';
import { useDataset } from '../../state/DataProvider';
import { useFilters } from '../../state/FilterProvider';
import { FilterPopover, OptionRow } from './Popover';

export function PeriodFilter() {
  const ds = useDataset();
  const { filters, update } = useFilters();
  const presets = periodPresets(ds);
  const current = matchPreset(ds, filters);
  const first = ds.calendar[0];
  const last = ds.calendar[ds.calendar.length - 1];

  return (
    <FilterPopover
      eyebrow="Period"
      label="기간"
      value={describePeriod(ds, filters)}
      active={current?.id !== 'all'}
      width={340}
    >
      {(close) => (
        <>
          <div className="option-list" role="radiogroup" aria-label="기간 프리셋">
            {presets.map((p, i) => (
              <div key={p.id} className={i > 0 && presetGroup(p.id) !== presetGroup(presets[i - 1].id) ? 'option-divider' : undefined}>
                <OptionRow
                  selected={current?.id === p.id}
                  disabled={p.disabled}
                  label={p.label}
                  hint={p.note ?? `${dotDay(p.start).slice(5)} – ${dotDay(p.end).slice(5)}`}
                  onSelect={() => {
                    update({ start: p.start, end: p.end });
                    close();
                  }}
                />
              </div>
            ))}
          </div>
          <CustomRange
            key={`${filters.start}/${filters.end}`}
            min={first}
            max={last}
            start={filters.start}
            end={filters.end}
            onApply={(start, end) => {
              update({ start, end });
              close();
            }}
          />
        </>
      )}
    </FilterPopover>
  );
}

/** 전체 / 분기 / 월 묶음 사이에 구분선을 긋기 위한 분류 */
function presetGroup(id: string): string {
  return id === 'all' ? 'all' : id.includes('Q') ? 'quarter' : 'month';
}

function CustomRange({
  min,
  max,
  start,
  end,
  onApply,
}: {
  min: string;
  max: string;
  start: string;
  end: string;
  onApply: (start: string, end: string) => void;
}) {
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);
  const valid = from >= min && to <= max && from <= to && from !== '' && to !== '';

  return (
    <form
      className="popover-foot custom-range"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onApply(from, to);
      }}
    >
      <p className="popover-foot-label">직접 지정</p>
      <div className="custom-range-inputs">
        <label>
          <span className="sr-only">시작일</span>
          <input type="date" value={from} min={min} max={max} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <span aria-hidden="true">–</span>
        <label>
          <span className="sr-only">종료일</span>
          <input type="date" value={to} min={min} max={max} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="submit" className="button button-primary" disabled={!valid}>
          적용
        </button>
      </div>
      {!valid && <p className="form-error">시작일이 종료일보다 늦거나 기간({dotDay(min)}–{dotDay(max)}) 밖입니다.</p>}
    </form>
  );
}
