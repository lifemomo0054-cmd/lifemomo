// 경계(TopoJSON)와 거주지 코드가 맞물리는지 확인한다.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import { decodeDataset } from './dataset';
import { summarize } from './engine';
import { defaultFilters } from './filters';
import { focusKeys, mapUnits, unitValue } from './map';
import type { RawDataset } from './types';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ds = decodeDataset(JSON.parse(readFileSync(`${root}web/public/data/population.json`, 'utf8')) as RawDataset);
const topo = JSON.parse(readFileSync(`${root}web/public/data/boundaries.json`, 'utf8')) as Topology;
const s = summarize(ds, defaultFilters(ds));

describe('지도 경계', () => {
  it('시군구: 경계가 없는 코드는 화성시 상위 코드(41590) 하나뿐', () => {
    const { units, unmapped } = mapUnits(ds, topo, 'sigungu');
    expect(units).toHaveLength(255);
    expect(unmapped.map((i) => ds.regions[i].code)).toEqual(['41590']);
  });

  it('시 단위: 일반구를 합치면 모든 값이 지도에 들어간다', () => {
    const { units, unmapped } = mapUnits(ds, topo, 'city');
    expect(unmapped).toHaveLength(0);
    const total = units.reduce((n, u) => n + unitValue(s, u), 0);
    expect(Math.abs(total - s.total)).toBeLessThan(0.01);
    const hwaseong = units.find((u) => u.key === '41590')!;
    expect(hwaseong.members.map((i) => ds.regions[i].code).sort()).toEqual(['41590', '41591', '41593', '41595', '41597']);
    expect(units.filter((u) => u.isStay).map((u) => u.key)).toEqual([ds.stayRegion.code]);
  });

  it('주변 보기: 체류지와 인접 시군은 들어가고 먼 섬(울릉군)은 빠진다', () => {
    const { units } = mapUnits(ds, topo, 'sigungu');
    const near = new Set(focusKeys(units));
    expect(near.has(ds.stayRegion.code)).toBe(true);
    ds.regions.filter((r) => r.adjacent).forEach((r) => expect(near.has(r.code)).toBe(true));
    expect(near.has('47940')).toBe(false);
  });

  it('출처 표기가 파일에 들어 있다', () => {
    expect((topo as Topology & { metadata: { attribution: string } }).metadata.attribution).toContain('SGIS');
  });
});
