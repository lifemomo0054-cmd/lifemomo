// 필터를 적용해 한 번에 집계하고, 화면에 필요한 시계열·구성비·KPI를 만든다.
// 체류인구수는 ×100 정수로 더한 뒤 마지막에 100으로 나눈다(소수 오차 없음).

import { dayRange, WEEKDAY_LABELS, weekdayOf } from './dates';
import { age10Label, regionMask, type Filters } from './filters';
import type { Dataset } from './types';

export interface Summary {
  filters: Filters;
  rowCount: number; // 필터에 걸린 원본 행 수
  nonzeroRows: number;
  cappedRows: number; // 상한값(5,932.84) 행 수
  total: number; // 체류인구수 합계 (연인원)
  external: number; // 김천시 자체 거주자를 뺀 합계
  capped: number; // 상한값 행의 합계
  periodDays: number; // 선택한 기간의 달력상 날 수
  dataDays: number; // 그중 데이터가 있는 날 수 (다른 필터와 무관)
  dateInPeriod: Uint8Array; // 데이터 날짜별 기간 포함 여부
  byDate: Float64Array; // 데이터 날짜별 합계
  byGender: Float64Array;
  byAge: Float64Array;
  byAgeGender: Float64Array; // [연령대 × 성별 수 + 성별]
  byDateAge: Float64Array; // [날짜 × 연령대 수 + 연령대]
  byDateGender: Float64Array; // [날짜 × 성별 수 + 성별]
  byLifeStage: Float64Array;
  byRegion: Float64Array;
  byRegionAge: Float64Array; // [거주지 × 연령대 수 + 연령대]
  byRegionGender: Float64Array; // [거주지 × 성별 수 + 성별]
  rowsByRegion: Int32Array;
  byZone: Float64Array;
}

export function summarize(ds: Dataset, filters: Filters): Summary {
  const { rows } = ds;
  const dateInPeriod = Uint8Array.from(ds.dates, (d) => (d >= filters.start && d <= filters.end ? 1 : 0));
  const regionOk = regionMask(ds, filters.region);
  const genderOk = Uint8Array.from(ds.genders, (g) => (filters.gender === 'all' || filters.gender === g.code ? 1 : 0));
  const chosenAges = new Set(filters.ages);
  const ageOk = Uint8Array.from(ds.ages, (a) => (chosenAges.size === 0 || chosenAges.has(a.code) ? 1 : 0));

  const byDate = new Float64Array(ds.dates.length);
  const byGender = new Float64Array(ds.genders.length);
  const byAge = new Float64Array(ds.ages.length);
  const nGender = ds.genders.length;
  const byAgeGender = new Float64Array(ds.ages.length * nGender);
  const nAge = ds.ages.length;
  const byDateAge = new Float64Array(ds.dates.length * nAge);
  const byDateGender = new Float64Array(ds.dates.length * nGender);
  const byRegion = new Float64Array(ds.regions.length);
  const byRegionAge = new Float64Array(ds.regions.length * nAge);
  const byRegionGender = new Float64Array(ds.regions.length * nGender);
  const rowsByRegion = new Int32Array(ds.regions.length);
  let rowCount = 0;
  let nonzeroRows = 0;
  let cappedRows = 0;
  let total = 0;
  let self = 0;

  for (let i = 0; i < rows.n; i++) {
    const d = rows.date[i];
    if (!dateInPeriod[d]) continue;
    const r = rows.region[i];
    if (!regionOk[r]) continue;
    const g = rows.gender[i];
    if (!genderOk[g]) continue;
    const a = rows.age[i];
    if (!ageOk[a]) continue;
    const p = rows.pop100[i];
    rowCount++;
    if (p > 0) nonzeroRows++;
    if (p === ds.cap100) cappedRows++;
    total += p;
    if (r === ds.stayRegionIndex) self += p;
    byDate[d] += p;
    byGender[g] += p;
    byAge[a] += p;
    byAgeGender[a * nGender + g] += p;
    byDateAge[d * nAge + a] += p;
    byDateGender[d * nGender + g] += p;
    byRegion[r] += p;
    byRegionAge[r * nAge + a] += p;
    byRegionGender[r * nGender + g] += p;
    rowsByRegion[r]++;
  }

  const toPeople = (arr: Float64Array) => arr.map((v) => v / 100);
  const byLifeStage = new Float64Array(ds.lifeStages.length);
  byAge.forEach((v, a) => (byLifeStage[ds.ageLifeStage[a]] += v));
  const byZone = new Float64Array(ds.zones.length);
  byRegion.forEach((v, r) => (byZone[ds.regionZone[r]] += v));

  return {
    filters,
    rowCount,
    nonzeroRows,
    cappedRows,
    total: total / 100,
    external: (total - self) / 100,
    capped: (cappedRows * ds.cap100) / 100,
    periodDays: dayRange(filters.start, filters.end).length,
    dataDays: dateInPeriod.reduce((n, v) => n + v, 0),
    dateInPeriod,
    byDate: toPeople(byDate),
    byGender: toPeople(byGender),
    byAge: toPeople(byAge),
    byAgeGender: toPeople(byAgeGender),
    byDateAge: toPeople(byDateAge),
    byDateGender: toPeople(byDateGender),
    byLifeStage: toPeople(byLifeStage),
    byRegion: toPeople(byRegion),
    byRegionAge: toPeople(byRegionAge),
    byRegionGender: toPeople(byRegionGender),
    rowsByRegion,
    byZone: toPeople(byZone),
  };
}

// ── 시계열 ───────────────────────────────────────────────────────────────────

export interface DailyPoint {
  day: string;
  weekday: number;
  hasData: boolean;
  value: number | null; // 데이터 없는 날은 null (0이 아님)
  ma7: number | null; // 최근 7일(달력 기준) 안의 데이터 있는 날 평균
}

export function dailySeries(ds: Dataset, s: Summary): DailyPoint[] {
  const byDay = new Map<string, number>();
  ds.dates.forEach((d, i) => s.dateInPeriod[i] && byDay.set(d, s.byDate[i]));
  const days = dayRange(s.filters.start, s.filters.end);
  const values = days.map((d) => byDay.get(d) ?? null);
  return days.map((day, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - 6); j <= i; j++) {
      const v = values[j];
      if (v !== null) {
        sum += v;
        n++;
      }
    }
    const value = values[i];
    return { day, weekday: weekdayOf(day), hasData: value !== null, value, ma7: value !== null && n > 0 ? sum / n : null };
  });
}

export interface MonthPoint {
  key: string;
  label: string;
  periodDays: number; // 선택한 기간 안의 날 수
  dataDays: number;
  sum: number | null;
  dailyMean: number | null;
}

export function monthlySeries(ds: Dataset, s: Summary): MonthPoint[] {
  const { start, end } = s.filters;
  return ds.months
    .filter((m) => m.lastDay >= start && m.firstDay <= end)
    .map((m) => {
      const mi = ds.months.indexOf(m);
      let sum = 0;
      let dataDays = 0;
      ds.dates.forEach((_, d) => {
        if (s.dateInPeriod[d] && ds.dateMonth[d] === mi) {
          sum += s.byDate[d];
          dataDays++;
        }
      });
      const from = m.firstDay > start ? m.firstDay : start;
      const to = m.lastDay < end ? m.lastDay : end;
      return {
        key: m.key,
        label: m.label,
        periodDays: dayRange(from, to).length,
        dataDays,
        sum: dataDays > 0 ? sum : null,
        dailyMean: dataDays > 0 ? sum / dataDays : null,
      };
    });
}

export interface WeekdayPoint {
  weekday: number;
  label: string;
  isWeekend: boolean;
  dataDays: number;
  sum: number;
  dailyMean: number | null;
}

export function weekdaySeries(ds: Dataset, s: Summary): WeekdayPoint[] {
  const sum = new Float64Array(7);
  const days = new Int32Array(7);
  ds.dates.forEach((_, d) => {
    if (!s.dateInPeriod[d]) return;
    sum[ds.dateWeekday[d]] += s.byDate[d];
    days[ds.dateWeekday[d]]++;
  });
  return WEEKDAY_LABELS.map((label, w) => ({
    weekday: w,
    label,
    isWeekend: w >= 5,
    dataDays: days[w],
    sum: sum[w],
    dailyMean: days[w] > 0 ? sum[w] / days[w] : null,
  }));
}

// ── 구성비 ───────────────────────────────────────────────────────────────────

export interface SharePoint {
  key: string;
  label: string;
  note?: string;
  value: number;
  share: number | null; // 합계가 0이면 null
}

function shares(items: { key: string; label: string; note?: string; value: number }[], total: number): SharePoint[] {
  return items.map((it) => ({ ...it, share: total > 0 ? it.value / total : null }));
}

export function genderShares(ds: Dataset, s: Summary): SharePoint[] {
  return shares(ds.genders.map((g, i) => ({ key: g.code, label: g.label, value: s.byGender[i] })), s.total);
}

export function lifeStageShares(ds: Dataset, s: Summary): SharePoint[] {
  return shares(ds.lifeStages.map((l, i) => ({ key: l.name, label: l.name, note: l.range, value: s.byLifeStage[i] })), s.total);
}

export interface Age10Point extends SharePoint {
  ages: string[]; // 묶인 원본 연령대
  byGender: SharePoint[]; // 이 연령대 안의 성별 구성 (share = 연령대 안에서의 비중)
}

/** 원본 연령대를 10세 단위로 묶는다 (00-09 / 10-14+15-19 / … / 80+). */
export function age10Series(ds: Dataset, s: Summary): Age10Point[] {
  const groups = new Map<string, number[]>();
  ds.ages.forEach((a, i) => groups.set(a.age10, [...(groups.get(a.age10) ?? []), i]));
  const nGender = ds.genders.length;
  return [...groups].map(([code, idx]) => {
    const value = idx.reduce((n, i) => n + s.byAge[i], 0);
    const genderValues = ds.genders.map((_, g) => idx.reduce((n, i) => n + s.byAgeGender[i * nGender + g], 0));
    return {
      key: code,
      label: age10Label(code),
      value,
      share: s.total > 0 ? value / s.total : null,
      ages: idx.map((i) => ds.ages[i].code),
      byGender: ds.genders.map((gd, g) => ({
        key: gd.code,
        label: gd.label,
        value: genderValues[g],
        share: value > 0 ? genderValues[g] / value : null,
      })),
    };
  });
}

export function zoneShares(ds: Dataset, s: Summary): SharePoint[] {
  return shares(ds.zones.map((z, i) => ({ key: z, label: z, value: s.byZone[i] })), s.total);
}

export interface RegionRank {
  index: number;
  code: string;
  name: string;
  full: string;
  sidoShort: string;
  zone: string;
  isStay: boolean;
  rows: number;
  value: number;
  share: number | null;
}

/** 합계가 큰 거주지 순서. 행이 없는 거주지는 뺀다. */
export function rankRegions(ds: Dataset, s: Summary): RegionRank[] {
  const sidoShort = new Map(ds.sidos.map((x) => [x.code, x.short]));
  return ds.regions
    .map((r, i) => ({
      index: i,
      code: r.code,
      name: r.name,
      full: r.full,
      sidoShort: sidoShort.get(r.sido) ?? r.sido,
      zone: r.zone,
      isStay: i === ds.stayRegionIndex,
      rows: s.rowsByRegion[i],
      value: s.byRegion[i],
      share: s.total > 0 ? s.byRegion[i] / s.total : null,
    }))
    .filter((r) => r.rows > 0)
    .sort((a, b) => b.value - a.value || a.code.localeCompare(b.code));
}

// ── KPI ──────────────────────────────────────────────────────────────────────

export interface Kpis {
  total: number;
  dailyMean: number | null;
  externalShare: number | null;
  selfShare: number | null;
  topOrigin: RegionRank | null; // 김천시 자체를 뺀 1위 거주지
  weekendMean: number | null;
  weekdayMean: number | null;
  weekendRatio: number | null;
  femaleShare: number | null;
  topLifeStage: SharePoint | null;
  topAge10: Age10Point | null;
  zeroRatio: number | null;
  cappedShare: number | null;
}

export function kpis(ds: Dataset, s: Summary): Kpis {
  const hasTotal = s.total > 0;
  const week = weekdaySeries(ds, s);
  const mean = (pts: WeekdayPoint[]) => {
    const days = pts.reduce((n, p) => n + p.dataDays, 0);
    return days > 0 ? pts.reduce((n, p) => n + p.sum, 0) / days : null;
  };
  const weekendMean = mean(week.filter((w) => w.isWeekend));
  const weekdayMean = mean(week.filter((w) => !w.isWeekend));
  const topOrigin = rankRegions(ds, s).find((r) => !r.isStay && r.value > 0) ?? null;
  const stages = lifeStageShares(ds, s);
  const topLifeStage = hasTotal ? stages.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const femaleIndex = ds.genders.findIndex((g) => g.code === 'female');
  const age10 = age10Series(ds, s);
  const topAge10 = hasTotal ? age10.reduce((a, b) => (b.value > a.value ? b : a)) : null;

  return {
    total: s.total,
    dailyMean: s.dataDays > 0 ? s.total / s.dataDays : null,
    externalShare: hasTotal ? s.external / s.total : null,
    selfShare: hasTotal ? 1 - s.external / s.total : null,
    topOrigin,
    weekendMean,
    weekdayMean,
    weekendRatio: weekendMean !== null && weekdayMean ? weekendMean / weekdayMean : null,
    femaleShare: hasTotal ? s.byGender[femaleIndex] / s.total : null,
    topLifeStage,
    topAge10,
    zeroRatio: s.rowCount > 0 ? 1 - s.nonzeroRows / s.rowCount : null,
    cappedShare: hasTotal ? s.capped / s.total : null,
  };
}
