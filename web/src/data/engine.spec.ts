// 브라우저 집계 엔진을 Python 집계표(data/processed/aggregates)와 대조한다.
// 두 계산이 서로 다른 언어·코드로 같은 숫자를 내는지 확인하는 것이 목적이다.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeDataset } from './dataset';
import {
  age10Series,
  dailySeries,
  genderShares,
  kpis,
  lifeStageShares,
  monthlySeries,
  rankRegions,
  summarize,
  weekdaySeries,
  zoneShares,
} from './engine';
import { activeFilterCount, defaultFilters, describeAges, describePeriod, periodPresets, type Filters } from './filters';
import type { RawDataset } from './types';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ds = decodeDataset(JSON.parse(readFileSync(`${root}web/public/data/population.json`, 'utf8')) as RawDataset);

function table(name: string): Record<string, string>[] {
  const [header, ...lines] = readFileSync(`${root}data/processed/aggregates/${name}.csv`, 'utf8')
    .replace(/^﻿/, '')
    .trim()
    .split('\n');
  const cols = header.split(',');
  return lines.map((line) => Object.fromEntries(line.split(',').map((v, i) => [cols[i], v])));
}

const all = defaultFilters(ds);
const with_ = (patch: Partial<Filters>): Filters => ({ ...all, ...patch });
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.006);

describe('전체 (필터 없음)', () => {
  const s = summarize(ds, all);

  it('합계·행 수가 원본 전체와 같다', () => {
    expect(s.rowCount).toBe(80_193);
    close(s.total, 1_690_156.93);
    expect(s.periodDays).toBe(181);
    expect(s.dataDays).toBe(150);
    expect(s.cappedRows).toBe(36);
  });

  it('일별 합계 = daily.csv, 데이터 없는 날은 null', () => {
    const points = new Map(dailySeries(ds, s).map((p) => [p.day, p]));
    for (const row of table('daily')) {
      const p = points.get(row.date)!;
      if (row.has_data === 'True') close(p.value!, Number(row.population_sum));
      else expect(p.value).toBeNull();
    }
    expect(dailySeries(ds, s).filter((p) => !p.hasData)).toHaveLength(31);
  });

  it('월별·요일별 일평균 = monthly.csv / weekday.csv', () => {
    const months = new Map(monthlySeries(ds, s).map((m) => [m.key, m]));
    for (const row of table('monthly')) {
      const m = months.get(row.year_month)!;
      expect(m.dataDays).toBe(Number(row.days_with_data));
      if (row.has_data === 'True') expect(m.dailyMean!).toBeCloseTo(Number(row.daily_mean), 3);
      else expect(m.dailyMean).toBeNull();
    }
    const week = weekdaySeries(ds, s);
    for (const row of table('weekday')) {
      expect(week[Number(row.weekday)].dailyMean!).toBeCloseTo(Number(row.daily_mean), 3);
    }
  });

  it('성별·연령대·생애단계 합계 = gender / age / life_stage.csv', () => {
    const g = new Map(genderShares(ds, s).map((x) => [x.key, x.value]));
    for (const row of table('gender')) close(g.get(row.gender_code)!, Number(row.population_sum));
    table('age').forEach((row, i) => close(s.byAge[i], Number(row.population_sum)));
    const l = new Map(lifeStageShares(ds, s).map((x) => [x.key, x.value]));
    for (const row of table('life_stage')) close(l.get(row.life_stage)!, Number(row.population_sum));
  });

  it('거주지별 합계·행 수 = origin_region.csv', () => {
    const ranked = new Map(rankRegions(ds, s).map((r) => [r.code, r]));
    const rows = table('origin_region');
    expect(ranked.size).toBe(rows.length);
    for (const row of rows) {
      const r = ranked.get(row.origin_region_code)!;
      close(r.value, Number(row.population_sum));
      expect(r.rows).toBe(Number(row.row_count));
    }
  });

  it('10세 단위 연령대 = age.csv 를 age_group_10yr 로 묶은 합계, 성별 교차합도 맞다', () => {
    const expected = new Map<string, number>();
    for (const row of table('age')) expected.set(row.age_group_10yr, (expected.get(row.age_group_10yr) ?? 0) + Number(row.population_sum));
    const series = age10Series(ds, s);
    expect(series.map((a) => a.key)).toEqual([...expected.keys()]);
    for (const a of series) {
      close(a.value, expected.get(a.key)!);
      close(a.byGender.reduce((n, g) => n + g.value, 0), a.value);
    }
    const g = new Map(table('gender').map((r) => [r.gender_code, Number(r.population_sum)]));
    ds.genders.forEach((gd) => close(series.reduce((n, a) => n + a.byGender.find((x) => x.key === gd.code)!.value, 0), g.get(gd.code)!));
    expect(series.map((a) => a.label)).toEqual(['0~9세', '10대', '20대', '30대', '40대', '50대', '60대', '70대', '80세 이상']);
  });

  it('날짜별 원본 행 수 = daily.csv row_count, 0이 아닌 최솟값', () => {
    const rows = new Map(table('daily').filter((r) => r.has_data === 'True').map((r) => [r.date, Number(r.row_count)]));
    ds.dates.forEach((d, i) => expect(ds.rowsPerDate[i]).toBe(rows.get(d)));
    expect(ds.minPositive100).toBe(300);
    expect(ds.stayName).toBe('김천시');
  });

  it('KPI', () => {
    const k = kpis(ds, s);
    expect(k.topOrigin?.code).toBe('47190');
    expect(k.topAge10?.label).toBe('50대');
    expect(k.selfShare!).toBeCloseTo(189_251.9 / 1_690_156.93, 9);
    expect(k.dailyMean!).toBeCloseTo(1_690_156.93 / 150, 6);
  });
});

describe('필터 조합', () => {
  it('성별 = 여성 → 날짜별 합계가 date_gender.csv 여성 행과 같다', () => {
    const s = summarize(ds, with_({ gender: 'female' }));
    const expected = new Map(table('date_gender').filter((r) => r.gender_code === 'female').map((r) => [r.date, Number(r.population_sum)]));
    ds.dates.forEach((d, i) => close(s.byDate[i], expected.get(d) ?? 0));
  });

  it('성별 = 여성 → 연령대 × 성별의 여성 칸이 연령대 합계와 같다', () => {
    const female = summarize(ds, with_({ gender: 'female' }));
    const both = summarize(ds, all);
    const fi = ds.genders.findIndex((g) => g.code === 'female');
    ds.ages.forEach((_, a) => close(female.byAge[a], both.byAgeGender[a * ds.genders.length + fi]));
  });

  it('거주지 = 구미시 → 연령대별 합계가 origin_region_age.csv 와 같다', () => {
    const s = summarize(ds, with_({ region: { kind: 'region', code: '47190' } }));
    const expected = new Map(table('origin_region_age').filter((r) => r.origin_region_code === '47190').map((r) => [r.age_group_original, Number(r.population_sum)]));
    ds.ages.forEach((a, i) => close(s.byAge[i], expected.get(a.code) ?? 0));
  });

  it('외부 유입 → 김천시 자체 거주자를 뺀 합계(external_population_sum)와 같다', () => {
    const s = summarize(ds, with_({ region: { kind: 'external' } }));
    const expected = table('gender').reduce((n, r) => n + Number(r.external_population_sum), 0);
    close(s.total, expected);
    expect(s.rowCount).toBe(80_193 - 196);
    expect(kpis(ds, s).externalShare).toBe(1);
  });

  it('권역·시도 필터는 해당 거주지 합계의 합과 같다', () => {
    const byCode = new Map(table('origin_region').map((r) => [r.origin_region_code, Number(r.population_sum)]));
    const sum = (pred: (i: number) => boolean) => ds.regions.reduce((n, r, i) => n + (pred(i) ? byCode.get(r.code) ?? 0 : 0), 0);
    close(summarize(ds, with_({ region: { kind: 'zone', zone: '대구' } })).total, sum((i) => ds.regions[i].zone === '대구'));
    close(summarize(ds, with_({ region: { kind: 'sido', sido: '41' } })).total, sum((i) => ds.regions[i].sido === '41'));
    const zones = zoneShares(ds, summarize(ds, all));
    close(zones.reduce((n, z) => n + z.value, 0), 1_690_156.93);
  });

  it('기간 = 6월 → 월별 합계가 monthly.csv 6월과 같다', () => {
    const june = periodPresets(ds).find((p) => p.id === '2026-06')!;
    const s = summarize(ds, with_({ start: june.start, end: june.end }));
    const row = table('monthly').find((r) => r.year_month === '2026-06')!;
    close(s.total, Number(row.population_sum));
    expect(s.dataDays).toBe(30);
    expect(monthlySeries(ds, s)).toHaveLength(1);
  });

  it('조건에 맞는 행이 없으면 0과 null 로 끝난다 (오류 없음)', () => {
    const s = summarize(ds, with_({ start: '2026-05-01', end: '2026-05-31' }));
    expect(s.rowCount).toBe(0);
    expect(s.dataDays).toBe(0);
    const k = kpis(ds, s);
    expect(k.dailyMean).toBeNull();
    expect(k.externalShare).toBeNull();
    expect(k.topOrigin).toBeNull();
  });
});

describe('필터 표시', () => {
  it('기간 프리셋: 5월은 데이터 없음으로 막혀 있다', () => {
    const presets = periodPresets(ds);
    expect(presets.find((p) => p.id === '2026-05')?.disabled).toBe(true);
    expect(presets.map((p) => p.label)).toEqual(['전체 기간', '1분기', '2분기', '1월', '2월', '3월', '4월', '5월', '6월']);
    expect(describePeriod(ds, all)).toBe('전체 기간');
    expect(describePeriod(ds, { start: '2026-01-05', end: '2026-02-10' })).toBe('2026.01.05 – 02.10');
  });

  it('연령 요약', () => {
    expect(describeAges(ds, [])).toBe('전체 연령');
    expect(describeAges(ds, ['20-24', '25-29', '30-34', '35-39'])).toBe('청년');
    expect(describeAges(ds, ['65-69', '70-74', '75-79', '80+', '00-09', '10-14', '15-19'])).toBe('아동청소년 · 고령');
    expect(describeAges(ds, ['20-24', '25-29'])).toBe('20~29세');
    expect(describeAges(ds, ['75-79', '80+'])).toBe('75세 이상');
    expect(describeAges(ds, ['00-09'])).toBe('0~9세');
    expect(describeAges(ds, ['00-09', '40-44'])).toBe('2개 연령대');
  });

  it('바뀐 필터 개수', () => {
    expect(activeFilterCount(ds, all)).toBe(0);
    expect(activeFilterCount(ds, with_({ gender: 'male', ages: ['80+'] }))).toBe(2);
  });
});
