// 연령·성별: 인구 피라미드, 성비, 생애단계 월별 구성, 권역 × 연령대

import { age10Series, type Summary } from './engine';
import { ageLabel } from './filters';
import type { Dataset } from './types';

export interface PyramidRow {
  code: string;
  label: string;
  values: number[]; // 성별 순서 (ds.genders)
  total: number;
}

/** 원본 연령대(젊은 쪽부터) × 성별 */
export function pyramid(ds: Dataset, s: Summary): PyramidRow[] {
  const n = ds.genders.length;
  return ds.ages.map((a, i) => {
    const values = ds.genders.map((_, g) => s.byAgeGender[i * n + g]);
    return { code: a.code, label: ageLabel(a.code), values, total: values.reduce((x, y) => x + y, 0) };
  });
}

export interface SexRatio {
  key: string;
  label: string;
  male: number;
  female: number;
  ratio: number | null; // 여성 100명당 남성
}

export function sexRatios(ds: Dataset, s: Summary): { overall: SexRatio; byAge: SexRatio[] } {
  const mi = ds.genders.findIndex((g) => g.code === 'male');
  const fi = ds.genders.findIndex((g) => g.code === 'female');
  const make = (key: string, label: string, male: number, female: number): SexRatio => ({
    key,
    label,
    male,
    female,
    ratio: female > 0 ? (male / female) * 100 : null,
  });
  return {
    overall: make('all', '전체', s.byGender[mi], s.byGender[fi]),
    byAge: age10Series(ds, s).map((a) => make(a.key, a.label, a.byGender[mi].value, a.byGender[fi].value)),
  };
}

export interface StageMonth {
  key: string;
  label: string;
  dataDays: number;
  values: number[]; // 생애단계 순서
  total: number;
}

/** 월별 생애단계 합계 */
export function lifeStagesByMonth(ds: Dataset, s: Summary): StageMonth[] {
  const nAge = ds.ages.length;
  const months = ds.months.filter((m) => m.lastDay >= s.filters.start && m.firstDay <= s.filters.end);
  return months.map((m) => {
    const mi = ds.months.indexOf(m);
    const values = ds.lifeStages.map(() => 0);
    let dataDays = 0;
    ds.dates.forEach((_, d) => {
      if (!s.dateInPeriod[d] || ds.dateMonth[d] !== mi) return;
      dataDays++;
      for (let a = 0; a < nAge; a++) values[ds.ageLifeStage[a]] += s.byDateAge[d * nAge + a];
    });
    return { key: m.key, label: m.label, dataDays, values, total: values.reduce((x, y) => x + y, 0) };
  });
}

export interface ZoneAgeRow {
  zone: string;
  total: number;
  values: number[]; // 10세 단위 연령대 순서
}

/** 권역 × 10세 연령대 합계 */
export function ageByZone(ds: Dataset, s: Summary): { cols: { key: string; label: string }[]; rows: ZoneAgeRow[] } {
  const nAge = ds.ages.length;
  const cols = age10Series(ds, s).map((a) => ({ key: a.key, label: a.label }));
  const colIndex = new Map(cols.map((c, i) => [c.key, i]));
  const rows: ZoneAgeRow[] = ds.zones.map((zone) => ({ zone, total: 0, values: cols.map(() => 0) }));
  ds.regions.forEach((_, r) => {
    const row = rows[ds.regionZone[r]];
    for (let a = 0; a < nAge; a++) {
      const v = s.byRegionAge[r * nAge + a];
      row.values[colIndex.get(ds.ages[a].age10)!] += v;
      row.total += v;
    }
  });
  return { cols, rows };
}

/** 인구를 연령 순서로 쌓았을 때 절반이 되는 원본 연령대 */
export function medianAgeBand(ds: Dataset, s: Summary): string | null {
  const total = s.byAge.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let acc = 0;
  for (let i = 0; i < ds.ages.length; i++) {
    acc += s.byAge[i];
    if (acc >= total / 2) return ds.ages[i].code;
  }
  return null;
}
