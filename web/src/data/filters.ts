import { dotDay } from './dates';
import type { Dataset, GenderCode } from './types';

export type GenderFilter = 'all' | GenderCode;

/** 거주지역 필터: 한 번에 한 범위만 고른다. */
export type RegionScope =
  | { kind: 'all' }
  | { kind: 'external' } // 김천시 자체 거주자를 뺀 외부 유입
  | { kind: 'zone'; zone: string }
  | { kind: 'sido'; sido: string }
  | { kind: 'city'; city: string } // 일반구를 합친 시 단위
  | { kind: 'region'; code: string };

export interface Filters {
  start: string;
  end: string;
  gender: GenderFilter;
  ages: string[]; // 비어 있으면 전체 연령
  region: RegionScope;
}

export interface PeriodPreset {
  id: string;
  label: string;
  start: string;
  end: string;
  disabled?: boolean;
  note?: string;
}

export function defaultFilters(ds: Dataset): Filters {
  return {
    start: ds.calendar[0],
    end: ds.calendar[ds.calendar.length - 1],
    gender: 'all',
    ages: [],
    region: { kind: 'all' },
  };
}

export function periodPresets(ds: Dataset): PeriodPreset[] {
  const first = ds.calendar[0];
  const last = ds.calendar[ds.calendar.length - 1];
  const presets: PeriodPreset[] = [{ id: 'all', label: '전체 기간', start: first, end: last }];

  const quarters = new Map<string, { start: string; end: string; months: number }>();
  for (const m of ds.months) {
    const q = `${m.year}-Q${Math.ceil(m.month / 3)}`;
    const cur = quarters.get(q);
    quarters.set(q, cur ? { ...cur, end: m.lastDay, months: cur.months + 1 } : { start: m.firstDay, end: m.lastDay, months: 1 });
  }
  for (const [key, q] of quarters) {
    if (q.months === 3 && q.start >= first && q.end <= last) {
      presets.push({ id: key, label: `${key.slice(-1)}분기`, start: q.start, end: q.end });
    }
  }

  for (const m of ds.months) {
    const start = m.firstDay < first ? first : m.firstDay;
    const end = m.lastDay > last ? last : m.lastDay;
    const hasData = ds.dates.some((d) => d >= start && d <= end);
    presets.push({
      id: m.key,
      label: m.label,
      start,
      end,
      disabled: !hasData,
      note: hasData ? undefined : '데이터 없음',
    });
  }
  return presets;
}

export function matchPreset(ds: Dataset, f: Pick<Filters, 'start' | 'end'>): PeriodPreset | undefined {
  return periodPresets(ds).find((p) => !p.disabled && p.start === f.start && p.end === f.end);
}

export function describePeriod(ds: Dataset, f: Pick<Filters, 'start' | 'end'>): string {
  return matchPreset(ds, f)?.label ?? `${dotDay(f.start)} – ${dotDay(f.end).slice(5)}`;
}

/** 00-09 → 0~9세, 10-14 → 10~14세, 80+ → 80세 이상 */
export function ageLabel(code: string): string {
  if (code.endsWith('+')) return `${Number(code.slice(0, -1))}세 이상`;
  const [lo, hi] = code.split('-').map(Number);
  return `${lo}~${hi}세`;
}

/** 10세 단위 연령대 표시: 00-09 → 0~9세, 30-39 → 30대, 80+ → 80세 이상 */
export function age10Label(code: string): string {
  if (code.endsWith('+')) return `${Number(code.slice(0, -1))}세 이상`;
  const lo = Number(code.split('-')[0]);
  return lo === 0 ? ageLabel(code) : `${lo}대`;
}

export function describeAges(ds: Dataset, ages: string[]): string {
  if (ages.length === 0 || ages.length === ds.ages.length) return '전체 연령';
  const chosen = new Set(ages);
  const order = ds.ages.map((a) => a.code).filter((c) => chosen.has(c));

  // 생애단계를 통째로 고른 경우
  const stages = ds.lifeStages.filter((s) => ds.ages.filter((a) => a.lifeStage === s.name).every((a) => chosen.has(a.code)));
  const stageAges = new Set(ds.ages.filter((a) => stages.some((s) => s.name === a.lifeStage)).map((a) => a.code));
  if (stages.length > 0 && stageAges.size === chosen.size) return stages.map((s) => s.name).join(' · ');

  if (order.length === 1) return ageLabel(order[0]);
  const idx = order.map((c) => ds.ages.findIndex((a) => a.code === c));
  const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (contiguous) {
    const lo = Number(order[0].split('-')[0].replace('+', ''));
    const last = order[order.length - 1];
    return last.endsWith('+') ? `${lo}세 이상` : `${lo}~${Number(last.split('-')[1])}세`;
  }
  return `${order.length}개 연령대`;
}

export function describeRegion(ds: Dataset, scope: RegionScope): string {
  switch (scope.kind) {
    case 'all':
      return '전체 거주지';
    case 'external':
      return `외부 유입 (${ds.stayName} 제외)`;
    case 'zone':
      return scope.zone;
    case 'sido':
      return ds.sidos.find((s) => s.code === scope.sido)?.name ?? scope.sido;
    case 'city': {
      const r = ds.regions.find((x) => x.city === scope.city);
      const sido = r && ds.sidos.find((x) => x.code === r.sido);
      return r ? `${sido?.name ?? ''} ${r.cityName}`.trim() : scope.city;
    }
    case 'region': {
      const r = ds.regions[ds.regionIndex.get(scope.code) ?? -1];
      return r ? r.full : scope.code;
    }
  }
}

export function sameScope(a: RegionScope, b: RegionScope): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 기본값과 다른 필터 개수 */
export function activeFilterCount(ds: Dataset, f: Filters): number {
  const d = defaultFilters(ds);
  return (
    Number(f.start !== d.start || f.end !== d.end) +
    Number(f.gender !== 'all') +
    Number(f.ages.length > 0 && f.ages.length < ds.ages.length) +
    Number(f.region.kind !== 'all')
  );
}

export function regionMask(ds: Dataset, scope: RegionScope): Uint8Array {
  return Uint8Array.from(ds.regions, (r, i) => {
    switch (scope.kind) {
      case 'all':
        return 1;
      case 'external':
        return i === ds.stayRegionIndex ? 0 : 1;
      case 'zone':
        return r.zone === scope.zone ? 1 : 0;
      case 'sido':
        return r.sido === scope.sido ? 1 : 0;
      case 'city':
        return r.city === scope.city ? 1 : 0;
      case 'region':
        return r.code === scope.code ? 1 : 0;
    }
  });
}
