// 지도: 경계(TopoJSON)와 집계 결과를 이어 붙인다.

import { geoCentroid, geoDistance } from 'd3-geo';
import type { Feature, Geometry, MultiPolygon } from 'geojson';
import { feature, merge, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Summary } from './engine';
import type { Dataset } from './types';

export type MapLevel = 'sigungu' | 'city';

export interface MapUnit {
  key: string;
  label: string;
  full: string;
  zone: string;
  members: number[]; // 묶인 거주지 위치
  feature: Feature<Geometry>;
  isStay: boolean;
}

interface Props {
  sgg: string;
  sido: string;
}

function collection(topo: Topology): GeometryCollection<Props> {
  return topo.objects.sgg as GeometryCollection<Props>;
}

/**
 * 지도 단위(시군구 또는 시)를 만든다. 경계가 없는 코드(예: 화성시 41590 — 경계는 4개 구로만 있음)는
 * 시군구 보기에서는 지도에 없고, 시 단위 보기에서는 같은 시의 구와 합쳐진다.
 */
export function mapUnits(ds: Dataset, topo: Topology, level: MapLevel): { units: MapUnit[]; unmapped: number[] } {
  const geoms = collection(topo).geometries;
  const byCode = new Map(geoms.map((g) => [String(g.id), g]));
  const sido = new Map(ds.sidos.map((s) => [s.code, s]));
  const unmapped: number[] = [];

  if (level === 'sigungu') {
    const units: MapUnit[] = [];
    ds.regions.forEach((r, i) => {
      const g = byCode.get(r.code);
      if (!g) {
        unmapped.push(i);
        return;
      }
      units.push({
        key: r.code,
        label: r.name,
        full: r.full,
        zone: r.zone,
        members: [i],
        feature: feature(topo, g) as Feature<Geometry>,
        isStay: i === ds.stayRegionIndex,
      });
    });
    return { units, unmapped };
  }

  const cities = new Map<string, number[]>();
  ds.regions.forEach((r, i) => cities.set(r.city, [...(cities.get(r.city) ?? []), i]));
  const units: MapUnit[] = [];
  for (const [city, members] of cities) {
    const parts = members.map((i) => byCode.get(ds.regions[i].code)).filter((g) => g !== undefined);
    if (parts.length === 0) {
      unmapped.push(...members);
      continue;
    }
    const r = ds.regions[members[0]];
    const geometry: MultiPolygon | Geometry = parts.length === 1 ? (feature(topo, parts[0]) as Feature<Geometry>).geometry : merge(topo, parts as never);
    units.push({
      key: city,
      label: r.cityName,
      full: `${sido.get(r.sido)?.name ?? ''} ${r.cityName}`.trim(),
      zone: r.zone,
      members,
      feature: { type: 'Feature', id: city, properties: {}, geometry },
      isStay: members.includes(ds.stayRegionIndex),
    });
  }
  return { units, unmapped };
}

/** 시도 사이 경계선 (굵게 그릴 선) */
export function sidoBorders(topo: Topology) {
  const sidoOf = (g: unknown) => (g as { properties: Props }).properties.sido;
  return mesh(topo, collection(topo), (a, b) => a !== b && sidoOf(a) !== sidoOf(b));
}

export function unitValue(s: Summary, u: MapUnit): number {
  return u.members.reduce((n, i) => n + s.byRegion[i], 0);
}

const EARTH_KM = 6371;
export const NEAR_KM = 130;

/** "주변" 보기의 범위: 체류지 중심에서 NEAR_KM 안에 중심이 있는 지역 (먼 섬은 빠진다) */
export function focusKeys(units: MapUnit[]): string[] {
  const stay = units.find((u) => u.isStay);
  if (!stay) return units.map((u) => u.key);
  const center = geoCentroid(stay.feature);
  return units.filter((u) => geoDistance(geoCentroid(u.feature), center) * EARTH_KM <= NEAR_KM).map((u) => u.key);
}
