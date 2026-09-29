// 시간 분석: 일·주·월 단위 묶기, 요일×월 표, 많은 날, 주말·평일 비교

import { addDays, dayRange, shortDay, WEEKDAY_LABELS, weekdayOf } from './dates';
import type { Summary } from './engine';
import type { Dataset } from './types';

export type Granularity = 'day' | 'week' | 'month';

export interface PeriodPoint {
  key: string;
  label: string;
  start: string;
  end: string;
  periodDays: number; // 선택 기간 안의 날 수
  dataDays: number; // 그중 데이터 있는 날 수
  sum: number | null; // 데이터 없는 구간은 null
  dailyMean: number | null;
}

/** 날짜 → 그날의 합계 (선택 기간 안, 데이터 있는 날만) */
export function dayValues(ds: Dataset, s: Summary): Map<string, number> {
  const out = new Map<string, number>();
  ds.dates.forEach((d, i) => s.dateInPeriod[i] && out.set(d, s.byDate[i]));
  return out;
}

export function periodSeries(ds: Dataset, s: Summary, unit: Granularity): PeriodPoint[] {
  const { start, end } = s.filters;
  const values = dayValues(ds, s);
  const bucket = (from: string, to: string, key: string, label: string): PeriodPoint => {
    const days = dayRange(from < start ? start : from, to > end ? end : to);
    const present = days.filter((d) => values.has(d));
    const sum = present.reduce((n, d) => n + values.get(d)!, 0);
    return {
      key,
      label,
      start: days[0],
      end: days[days.length - 1],
      periodDays: days.length,
      dataDays: present.length,
      sum: present.length ? sum : null,
      dailyMean: present.length ? sum / present.length : null,
    };
  };

  if (unit === 'day') return dayRange(start, end).map((d) => bucket(d, d, d, shortDay(d)));
  if (unit === 'month') {
    return ds.months
      .filter((m) => m.lastDay >= start && m.firstDay <= end)
      .map((m) => bucket(m.firstDay, m.lastDay, m.key, m.label));
  }
  // 주: 월요일 시작
  const out: PeriodPoint[] = [];
  for (let monday = addDays(start, -weekdayOf(start)); monday <= end; monday = addDays(monday, 7)) {
    out.push(bucket(monday, addDays(monday, 6), monday, `${shortDay(monday)}~`));
  }
  return out;
}

export interface HeatCell {
  row: number; // months 위치
  col: number; // 요일 (0 = 월)
  dataDays: number;
  sum: number;
  mean: number | null;
}

/** 월 × 요일 일평균 표 */
export function weekdayMonthMatrix(ds: Dataset, s: Summary) {
  const months = ds.months.filter((m) => m.lastDay >= s.filters.start && m.firstDay <= s.filters.end);
  const index = new Map(months.map((m, i) => [ds.months.indexOf(m), i]));
  const cells: HeatCell[] = months.flatMap((_, row) => WEEKDAY_LABELS.map((_, col) => ({ row, col, dataDays: 0, sum: 0, mean: null })));
  ds.dates.forEach((_, d) => {
    if (!s.dateInPeriod[d]) return;
    const row = index.get(ds.dateMonth[d]);
    if (row === undefined) return;
    const cell = cells[row * 7 + ds.dateWeekday[d]];
    cell.dataDays++;
    cell.sum += s.byDate[d];
  });
  cells.forEach((c) => (c.mean = c.dataDays ? c.sum / c.dataDays : null));
  return { rows: months.map((m) => m.label), cols: WEEKDAY_LABELS, cells };
}

export interface DayRank {
  day: string;
  weekday: number;
  value: number;
  rows: number; // 그날 원본 행 수
}

export function rankDays(ds: Dataset, s: Summary): DayRank[] {
  return ds.dates
    .map((day, d) => ({ day, d }))
    .filter(({ d }) => s.dateInPeriod[d])
    .map(({ day, d }) => ({ day, weekday: ds.dateWeekday[d], value: s.byDate[d], rows: ds.rowsPerDate[d] }))
    .sort((a, b) => b.value - a.value || a.day.localeCompare(b.day));
}

export interface WeekSplit {
  key: string;
  label: string;
  weekendMean: number | null;
  weekdayMean: number | null;
  ratio: number | null;
}

/** 월별 주말·평일 일평균 */
export function weekendByMonth(ds: Dataset, s: Summary): WeekSplit[] {
  const values = dayValues(ds, s);
  return ds.months
    .filter((m) => m.lastDay >= s.filters.start && m.firstDay <= s.filters.end)
    .map((m) => {
      const acc = { we: [0, 0], wd: [0, 0] };
      for (const d of dayRange(m.firstDay, m.lastDay)) {
        const v = values.get(d);
        if (v === undefined) continue;
        const slot = weekdayOf(d) >= 5 ? acc.we : acc.wd;
        slot[0] += v;
        slot[1]++;
      }
      const weekendMean = acc.we[1] ? acc.we[0] / acc.we[1] : null;
      const weekdayMean = acc.wd[1] ? acc.wd[0] / acc.wd[1] : null;
      return { key: m.key, label: m.label, weekendMean, weekdayMean, ratio: weekendMean !== null && weekdayMean ? weekendMean / weekdayMean : null };
    });
}

/** 일별 합계의 변동계수 (표준편차 ÷ 평균) */
export function dailyVariation(ds: Dataset, s: Summary): number | null {
  const v = [...dayValues(ds, s).values()];
  if (v.length < 2) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  if (mean === 0) return null;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
  return sd / mean;
}

export interface MonthChange {
  key: string;
  label: string;
  dailyMean: number | null;
  prevLabel: string | null; // 비교한 앞 달 (데이터 있는 가장 가까운 달)
  change: number | null; // 앞 달 대비 증감률
}

export function monthChanges(points: PeriodPoint[]): MonthChange[] {
  let prev: PeriodPoint | null = null;
  return points.map((p) => {
    const out: MonthChange = {
      key: p.key,
      label: p.label,
      dailyMean: p.dailyMean,
      prevLabel: p.dailyMean !== null && prev ? prev.label : null,
      change: p.dailyMean !== null && prev?.dailyMean ? p.dailyMean / prev.dailyMean - 1 : null,
    };
    if (p.dailyMean !== null) prev = p;
    return out;
  });
}
