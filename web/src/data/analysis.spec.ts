// 화면별 분석 함수(시간·인구구조·유입지역·탐색)를 Python 집계표와 대조한다.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeDataset } from './dataset';
import { ageByZone, lifeStagesByMonth, medianAgeBand, pyramid, sexRatios } from './demographics';
import { summarize } from './engine';
import { filterRows, pivot, rowsCsv } from './explore';
import { defaultFilters, describeRegion, type Filters } from './filters';
import { concentration, rankOrigins } from './origins';
import { dailyVariation, monthChanges, periodSeries, rankDays, weekdayMonthMatrix, weekendByMonth } from './time';
import type { RawDataset } from './types';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ds = decodeDataset(JSON.parse(readFileSync(`${root}web/public/data/population.json`, 'utf8')) as RawDataset);

function table(name: string): Record<string, string>[] {
  const [header, ...lines] = readFileSync(`${root}data/processed/aggregates/${name}.csv`, 'utf8').replace(/^﻿/, '').trim().split('\n');
  const cols = header.split(',');
  return lines.map((line) => Object.fromEntries(line.split(',').map((v, i) => [cols[i], v])));
}

const all = defaultFilters(ds);
const with_ = (patch: Partial<Filters>): Filters => ({ ...all, ...patch });
const s = summarize(ds, all);
const TOTAL = 1_690_156.93;
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.006);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const byCode = new Map(table('origin_region').map((r) => [r.origin_region_code, Number(r.population_sum)]));

describe('시간 분석', () => {
  it('월 단위 일평균 = monthly.csv, 5월은 null', () => {
    const months = new Map(periodSeries(ds, s, 'month').map((p) => [p.key, p]));
    for (const row of table('monthly')) {
      const p = months.get(row.year_month)!;
      expect(p.dataDays).toBe(Number(row.days_with_data));
      if (row.has_data === 'True') expect(p.dailyMean!).toBeCloseTo(Number(row.daily_mean), 3);
      else expect(p.sum).toBeNull();
    }
  });

  it('일·주 단위로 묶어도 합계가 전체와 같고, 주는 월요일에 시작한다', () => {
    for (const unit of ['day', 'week'] as const) close(sum(periodSeries(ds, s, unit).map((p) => p.sum ?? 0)), TOTAL);
    const weeks = periodSeries(ds, s, 'week');
    expect(weeks[0].key).toBe('2025-12-29'); // 2026-01-01(목)이 속한 주의 월요일
    expect(weeks[0].start).toBe('2026-01-01'); // 기간 밖 날짜는 잘라 낸다
    expect(sum(weeks.map((w) => w.periodDays))).toBe(181);
  });

  it('월 × 요일 표: 합계와 날 수가 전체와 같다', () => {
    const m = weekdayMonthMatrix(ds, s);
    expect(m.rows).toEqual(['1월', '2월', '3월', '4월', '5월', '6월']);
    close(sum(m.cells.map((c) => c.sum)), TOTAL);
    expect(sum(m.cells.map((c) => c.dataDays))).toBe(150);
    expect(m.cells.filter((c) => c.row === 4).every((c) => c.mean === null)).toBe(true);
  });

  it('가장 많은 날 = daily.csv 최댓값, 주말·평일 비교, 변동계수, 전월 대비', () => {
    const daily = table('daily').filter((r) => r.has_data === 'True');
    const max = daily.reduce((a, b) => (Number(b.population_sum) > Number(a.population_sum) ? b : a));
    const top = rankDays(ds, s)[0];
    expect(top.day).toBe(max.date);
    expect(top.rows).toBe(Number(max.row_count));
    expect(weekendByMonth(ds, s).find((w) => w.key === '2026-05')?.ratio).toBeNull();
    expect(dailyVariation(ds, s)!).toBeGreaterThan(1);
    const changes = monthChanges(periodSeries(ds, s, 'month'));
    expect(changes.find((c) => c.key === '2026-06')?.prevLabel).toBe('4월'); // 5월을 건너뛰고 비교
  });
});

describe('연령·성별', () => {
  it('피라미드 합계 = age.csv, 성비', () => {
    const rows = pyramid(ds, s);
    table('age').forEach((row, i) => close(rows[i].total, Number(row.population_sum)));
    const g = new Map(table('gender').map((r) => [r.gender_code, Number(r.population_sum)]));
    expect(sexRatios(ds, s).overall.ratio!).toBeCloseTo((g.get('male')! / g.get('female')!) * 100, 6);
  });

  it('월별 생애단계 합계 = life_stage.csv', () => {
    const months = lifeStagesByMonth(ds, s);
    const expected = new Map(table('life_stage').map((r) => [r.life_stage, Number(r.population_sum)]));
    ds.lifeStages.forEach((st, k) => close(sum(months.map((m) => m.values[k])), expected.get(st.name)!));
  });

  it('권역 × 연령대 합계 = 권역별 거주지 합계', () => {
    const { rows } = ageByZone(ds, s);
    for (const row of rows) {
      const expected = sum(ds.regions.filter((r) => r.zone === row.zone).map((r) => byCode.get(r.code) ?? 0));
      close(row.total, expected);
      close(sum(row.values), row.total);
    }
    expect(medianAgeBand(ds, s)).toBe('40-44');
  });
});

describe('유입지역', () => {
  it('시 단위: 일반구를 합친다 (수원시, 화성시 41590 + 일반구)', () => {
    const cities = new Map(rankOrigins(ds, s, 'city').map((c) => [c.key, c]));
    close(cities.get('41110')!.value, sum(['41111', '41113', '41115', '41117'].map((c) => byCode.get(c)!)));
    close(cities.get('41590')!.value, sum(['41590', '41591', '41593', '41595', '41597'].map((c) => byCode.get(c)!)));
    expect(describeRegion(ds, { kind: 'city', city: '41590' })).toBe('경기도 화성시');
    close(summarize(ds, with_({ region: { kind: 'city', city: '41590' } })).total, cities.get('41590')!.value);
  });

  it('시도·권역 합계, 집중도', () => {
    for (const level of ['sigungu', 'city', 'sido', 'zone'] as const) close(sum(rankOrigins(ds, s, level).map((r) => r.value)), TOTAL);
    const c = concentration(rankOrigins(ds, s, 'sigungu'));
    const external = TOTAL - byCode.get('47150')!;
    expect(c.top1!).toBeCloseTo(byCode.get('47190')! / external, 9);
    expect(c.count).toBe(255);
  });
});

describe('데이터 탐색', () => {
  it('행 필터 = summarize 와 같은 행, 피벗 합계 = gender.csv', () => {
    for (const f of [all, with_({ gender: 'female', ages: ['20-24'] }), with_({ region: { kind: 'zone', zone: '대구' } })]) {
      expect(filterRows(ds, f).length).toBe(summarize(ds, f).rowCount);
    }
    const idx = filterRows(ds, all);
    const byGender = new Map(pivot(ds, idx, ['gender']).map((p) => [p.labels[0], p]));
    for (const row of table('gender')) close(byGender.get(row.gender_code === 'male' ? '남성' : '여성')!.sum, Number(row.population_sum));
    expect(pivot(ds, idx, ['month', 'lifeStage'])).toHaveLength(5 * 4);
  });

  it('CSV: BOM + 머리글 + 행 수', () => {
    const idx = filterRows(ds, with_({ region: { kind: 'region', code: '47150' } }));
    const csv = rowsCsv(ds, idx);
    expect(csv.startsWith('﻿기준일자,요일,거주지시군구코드')).toBe(true);
    expect(csv.trim().split('\r\n')).toHaveLength(idx.length + 1);
  });
});
