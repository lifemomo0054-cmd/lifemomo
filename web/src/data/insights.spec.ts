import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeDataset } from './dataset';
import { summarize } from './engine';
import { defaultFilters } from './filters';
import { josa } from './format';
import { aiContext, findings } from './insights';
import type { RawDataset } from './types';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ds = decodeDataset(JSON.parse(readFileSync(`${root}web/public/data/population.json`, 'utf8')) as RawDataset);
const all = defaultFilters(ds);

describe('조사', () => {
  it('받침에 맞게 붙는다', () => {
    expect(josa('50대', '이', '가')).toBe('50대가');
    expect(josa('80세 이상', '이', '가')).toBe('80세 이상이');
    expect(josa('김천시', '과', '와')).toBe('김천시와');
    expect(josa('칠곡군', '과', '와')).toBe('칠곡군과');
    expect(josa('2.1 (일)', '이', '가')).toBe('2.1 (일)이');
  });
});

describe('규칙 기반 자동 요약', () => {
  it('전체 조건: 규모·시간·구조·유입·주의 항목이 나오고 숫자는 집계와 같다', () => {
    const list = findings(ds, summarize(ds, all));
    const ids = list.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['scale', 'weekend', 'peak', 'month', 'age', 'sex', 'origins', 'adjacent', 'gap', 'cap', 'self']));
    expect(list.find((f) => f.id === 'scale')!.metric.value).toBe('11,268명');
    expect(list.find((f) => f.id === 'weekend')!.metric.value).toBe('×1.50');
    expect(list.find((f) => f.id === 'gap')!.metric.value).toBe('31일');
    expect(list.find((f) => f.id === 'origins')!.text).toContain('경북 구미시');
    expect(list.find((f) => f.id === 'month')!.text).toContain('사이의 5월은 데이터가 없어 4월과 비교했습니다');
  });

  it('외부 유입만 보면 체류지 자체 경고가 사라지고, 데이터가 없으면 빈 목록', () => {
    const ext = findings(ds, summarize(ds, { ...all, region: { kind: 'external' } }));
    expect(ext.some((f) => f.id === 'self')).toBe(false);
    expect(findings(ds, summarize(ds, { ...all, start: '2026-05-01', end: '2026-05-31' }))).toEqual([]);
  });

  it('AI에 보낼 요약 첫 줄에 합성데이터임을 밝힌다', () => {
    const s = summarize(ds, all);
    const text = aiContext(ds, s, findings(ds, s));
    expect(text.split('\n')[0]).toContain('합성데이터');
    expect(text).toContain('[조건] 기간 전체 기간');
  });
});
