import { useEffect, useState } from 'react';
import type { Topology } from 'topojson-specification';

export interface BoundaryTopology extends Topology {
  metadata?: { attribution: string; version: string; source: string; license: string };
}

const URL = `${import.meta.env.BASE_URL}data/boundaries.json`;
let cache: Promise<BoundaryTopology> | null = null;

/** 시군구 경계(TopoJSON). 지도 화면에 처음 들어올 때 한 번만 받는다. */
export function useBoundaries(): { topo: BoundaryTopology | null; error: string | null } {
  const [state, setState] = useState<{ topo: BoundaryTopology | null; error: string | null }>({ topo: null, error: null });
  useEffect(() => {
    let alive = true;
    cache ??= fetch(URL).then((res) => {
      if (!res.ok) throw new Error(`경계 데이터를 불러오지 못했습니다 (${res.status}).`);
      return res.json() as Promise<BoundaryTopology>;
    });
    cache
      .then((topo) => alive && setState({ topo, error: null }))
      .catch((e: unknown) => {
        cache = null;
        if (alive) setState({ topo: null, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
