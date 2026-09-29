// 데이터 탐색: 필터에 걸린 행 목록, 원하는 기준으로 묶은 피벗, CSV 내려받기

import { WEEKDAY_LABELS } from './dates';
import { age10Label, ageLabel, regionMask, type Filters } from './filters';
import type { Dataset } from './types';

/** 필터에 맞는 원본 행 위치 (engine.summarize 와 같은 조건) */
export function filterRows(ds: Dataset, f: Filters): Int32Array {
  const { rows } = ds;
  const dateOk = Uint8Array.from(ds.dates, (d) => (d >= f.start && d <= f.end ? 1 : 0));
  const regionOk = regionMask(ds, f.region);
  const genderOk = Uint8Array.from(ds.genders, (g) => (f.gender === 'all' || f.gender === g.code ? 1 : 0));
  const ages = new Set(f.ages);
  const ageOk = Uint8Array.from(ds.ages, (a) => (ages.size === 0 || ages.has(a.code) ? 1 : 0));
  const out = new Int32Array(rows.n);
  let n = 0;
  for (let i = 0; i < rows.n; i++) {
    if (dateOk[rows.date[i]] && regionOk[rows.region[i]] && genderOk[rows.gender[i]] && ageOk[rows.age[i]]) out[n++] = i;
  }
  return out.slice(0, n);
}

export type Dim = 'date' | 'month' | 'weekday' | 'sigungu' | 'city' | 'sido' | 'zone' | 'gender' | 'age' | 'age10' | 'lifeStage';

export const DIMS: { value: Dim; label: string; group: string }[] = [
  { value: 'date', label: '날짜', group: '시간' },
  { value: 'month', label: '월', group: '시간' },
  { value: 'weekday', label: '요일', group: '시간' },
  { value: 'sigungu', label: '시군구', group: '거주지' },
  { value: 'city', label: '시 단위', group: '거주지' },
  { value: 'sido', label: '시도', group: '거주지' },
  { value: 'zone', label: '권역', group: '거주지' },
  { value: 'gender', label: '성별', group: '인구' },
  { value: 'age', label: '연령대(원본)', group: '인구' },
  { value: 'age10', label: '연령대(10세)', group: '인구' },
  { value: 'lifeStage', label: '생애단계', group: '인구' },
];

/** 행 i 의 기준값: [정렬 순서, 표시 이름] */
export function dimValue(ds: Dataset, dim: Dim, i: number): [number, string] {
  const { rows } = ds;
  const d = rows.date[i];
  const r = ds.regions[rows.region[i]];
  const a = ds.ages[rows.age[i]];
  switch (dim) {
    case 'date':
      return [d, ds.dates[d]];
    case 'month':
      return [ds.dateMonth[d], ds.months[ds.dateMonth[d]].label];
    case 'weekday':
      return [ds.dateWeekday[d], `${WEEKDAY_LABELS[ds.dateWeekday[d]]}요일`];
    case 'sigungu':
      return [rows.region[i], r.full];
    case 'city': {
      const sido = ds.sidos.find((x) => x.code === r.sido)!;
      return [Number(r.city), `${sido.name} ${r.cityName}`];
    }
    case 'sido':
      return [Number(r.sido), ds.sidos.find((x) => x.code === r.sido)!.name];
    case 'zone':
      return [ds.regionZone[rows.region[i]], r.zone];
    case 'gender':
      return [rows.gender[i], ds.genders[rows.gender[i]].label];
    case 'age':
      return [rows.age[i], ageLabel(a.code)];
    case 'age10':
      return [Number(a.age10.slice(0, 2)), age10Label(a.age10)];
    case 'lifeStage':
      return [ds.ageLifeStage[rows.age[i]], a.lifeStage];
  }
}

export interface PivotRow {
  key: string;
  labels: string[];
  order: number[];
  rows: number;
  nonzero: number;
  sum: number;
  share: number | null;
}

export function pivot(ds: Dataset, idx: Int32Array, dims: Dim[]): PivotRow[] {
  const groups = new Map<string, PivotRow>();
  let total = 0;
  for (const i of idx) {
    const parts = dims.map((dim) => dimValue(ds, dim, i));
    const key = parts.map((p) => p[1]).join('\u0000');
    let g = groups.get(key);
    if (!g) {
      g = { key, labels: parts.map((p) => p[1]), order: parts.map((p) => p[0]), rows: 0, nonzero: 0, sum: 0, share: null };
      groups.set(key, g);
    }
    const p = ds.rows.pop100[i];
    g.rows++;
    if (p > 0) g.nonzero++;
    g.sum += p;
    total += p;
  }
  return [...groups.values()].map((g) => ({ ...g, sum: g.sum / 100, share: total > 0 ? g.sum / total : null }));
}

export interface RowView {
  index: number;
  date: string;
  weekday: string;
  regionCode: string;
  region: string;
  zone: string;
  gender: string;
  age: string;
  lifeStage: string;
  population: number;
  flags: string[];
}

export function rowView(ds: Dataset, i: number): RowView {
  const { rows } = ds;
  const r = ds.regions[rows.region[i]];
  const p = rows.pop100[i];
  const flags: string[] = [];
  if (p === 0) flags.push('0');
  if (p === ds.cap100) flags.push('상한값');
  if (rows.region[i] === ds.stayRegionIndex) flags.push('체류지 자체');
  return {
    index: i,
    date: ds.dates[rows.date[i]],
    weekday: WEEKDAY_LABELS[ds.dateWeekday[rows.date[i]]],
    regionCode: r.code,
    region: r.full,
    zone: r.zone,
    gender: ds.genders[rows.gender[i]].label,
    age: ageLabel(ds.ages[rows.age[i]].code),
    lifeStage: ds.ages[rows.age[i]].lifeStage,
    population: p / 100,
    flags,
  };
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 엑셀에서 한글이 깨지지 않도록 BOM을 붙인 CSV */
export function toCsv(header: string[], body: (string | number)[][]): string {
  return '﻿' + [header, ...body].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function rowsCsv(ds: Dataset, idx: Int32Array): string {
  const header = ['기준일자', '요일', '거주지시군구코드', '거주지', '권역', '성별', '연령대', '생애단계', '생활인구', '표시'];
  const body = Array.from(idx, (i) => {
    const v = rowView(ds, i);
    return [v.date, v.weekday, v.regionCode, v.region, v.zone, v.gender, v.age, v.lifeStage, v.population, v.flags.join(' ')];
  });
  return toCsv(header, body);
}
