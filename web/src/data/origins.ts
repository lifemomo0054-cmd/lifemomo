// 유입지역: 시군구·시·시도·권역 단위 순위와 집중도

import type { Summary } from './engine';
import type { RegionScope } from './filters';
import type { Dataset } from './types';

export type OriginLevel = 'sigungu' | 'city' | 'sido' | 'zone';

export const ORIGIN_LEVELS: { value: OriginLevel; label: string }[] = [
  { value: 'sigungu', label: '시군구' },
  { value: 'city', label: '시 단위' },
  { value: 'sido', label: '시도' },
  { value: 'zone', label: '권역' },
];

export interface OriginRank {
  key: string;
  label: string; // 이름
  prefix: string; // 앞에 붙는 작은 글씨 (시도 등)
  full: string;
  zone: string;
  scope: RegionScope; // 이 항목만 보는 거주지역 필터
  members: number[]; // 묶인 거주지 위치
  containsStay: boolean;
  rows: number;
  value: number;
  share: number | null;
}

export function rankOrigins(ds: Dataset, s: Summary, level: OriginLevel): OriginRank[] {
  const sido = new Map(ds.sidos.map((x) => [x.code, x]));
  const groups = new Map<string, OriginRank>();
  ds.regions.forEach((r, i) => {
    const sd = sido.get(r.sido)!;
    const [key, label, prefix, full, scope, zone]: [string, string, string, string, RegionScope, string] =
      level === 'sigungu'
        ? [r.code, r.name, sd.short, r.full, { kind: 'region', code: r.code }, r.zone]
        : level === 'city'
          ? [r.city, r.cityName, sd.short, `${sd.name} ${r.cityName}`, { kind: 'city', city: r.city }, r.zone]
          : level === 'sido'
            ? [r.sido, sd.name, '', sd.name, { kind: 'sido', sido: r.sido }, '']
            : [r.zone, r.zone, '', r.zone, { kind: 'zone', zone: r.zone }, r.zone];
    const g =
      groups.get(key) ??
      groups
        .set(key, { key, label, prefix, full, zone, scope, members: [], containsStay: false, rows: 0, value: 0, share: null })
        .get(key)!;
    g.members.push(i);
    g.containsStay ||= i === ds.stayRegionIndex;
    g.rows += s.rowsByRegion[i];
    g.value += s.byRegion[i];
  });
  return [...groups.values()]
    .filter((g) => g.rows > 0)
    .map((g) => ({ ...g, share: s.total > 0 ? g.value / s.total : null }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

export interface Concentration {
  count: number; // 생활인구가 0보다 큰 항목 수
  top1: number | null;
  top5: number | null;
  top10: number | null;
  hhi: number | null; // 허핀달-허쉬만 지수 (0~10,000)
}

/** 순위의 집중도. 체류지 자체는 빼고 외부 유입 기준으로 계산한다. */
export function concentration(ranked: OriginRank[]): Concentration {
  const ext = ranked.filter((r) => !r.containsStay && r.value > 0);
  const total = ext.reduce((n, r) => n + r.value, 0);
  if (total <= 0) return { count: 0, top1: null, top5: null, top10: null, hhi: null };
  const top = (k: number) => ext.slice(0, k).reduce((n, r) => n + r.value, 0) / total;
  return {
    count: ext.length,
    top1: top(1),
    top5: top(5),
    top10: top(10),
    hhi: ext.reduce((n, r) => n + ((r.value / total) * 100) ** 2, 0),
  };
}
