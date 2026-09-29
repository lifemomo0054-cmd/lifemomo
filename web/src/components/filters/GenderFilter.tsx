import type { GenderFilter as Gender } from '../../data/filters';
import { useDataset } from '../../state/DataProvider';
import { useFilters } from '../../state/FilterProvider';

export function GenderFilter() {
  const ds = useDataset();
  const { filters, update } = useFilters();
  const options: { value: Gender; label: string }[] = [
    { value: 'all', label: '전체' },
    ...ds.genders.map((g) => ({ value: g.code, label: g.label })),
  ];

  return (
    <div className="field">
      <span className="field-label" id="gender-label">
        <span className="field-eyebrow">Sex</span>
        성별
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby="gender-label">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={filters.gender === o.value}
            className="segmented-item"
            onClick={() => update({ gender: o.value })}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
