import { useMemo, useState } from 'react';
import { BarList } from '../components/charts/BarList';
import { binOf, ChoroplethMap, logBins, type MapArea } from '../components/charts/ChoroplethMap';
import { StatTile } from '../components/ui/Metrics';
import { PageHeader, Segmented } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { kpis } from '../data/engine';
import { fmtInt, fmtPct } from '../data/format';
import { focusKeys, mapUnits, NEAR_KM, sidoBorders, unitValue, type MapLevel } from '../data/map';
import { useBoundaries } from '../state/boundaries';
import { useDataset } from '../state/DataProvider';
import { useFilters } from '../state/FilterProvider';

type View = 'near' | 'nation';
const FLOWS = 10;
const LIST = 12;

export function MapPage() {
  const ds = useDataset();
  const { summary: s } = useFilters();
  const { topo, error } = useBoundaries();
  const [level, setLevel] = useState<MapLevel>('sigungu');
  const [view, setView] = useState<View>('near');
  const [showFlows, setShowFlows] = useState(true);
  const [hover, setHover] = useState<string | null>(null);

  const base = useMemo(() => (topo ? { ...mapUnits(ds, topo, level), borders: sidoBorders(topo) } : null), [ds, topo, level]);
  const k = useMemo(() => kpis(ds, s), [ds, s]);

  const view$ = useMemo(() => {
    if (!base) return null;
    const valued = base.units.map((u) => ({ u, value: unitValue(s, u) }));
    const ranked = [...valued].filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
    const rank = new Map(ranked.map((x, i) => [x.u.key, i + 1]));
    const thresholds = logBins(valued.filter((x) => !x.u.isStay).map((x) => x.value));
    const areas: MapArea[] = valued.map(({ u, value }) => ({
      key: u.key,
      label: u.full,
      shortLabel: u.label,
      feature: u.feature,
      value,
      isStay: u.isStay,
      tooltip: [
        { label: '명', value: fmtInt(value) },
        { label: '전체 대비', value: fmtPct(s.total > 0 ? value / s.total : null) },
        { label: '순위', value: rank.has(u.key) ? `${fmtInt(rank.get(u.key)!)}위` : '—' },
        { label: '권역', value: u.isStay ? `${u.zone} · 체류지` : u.zone },
      ],
    }));
    const external = ranked.filter((x) => !x.u.isStay);
    const unmappedValue = base.unmapped.reduce((n, i) => n + s.byRegion[i], 0);
    return { areas, ranked, external, thresholds, rank, unmappedValue, focus: focusKeys(base.units) };
  }, [base, s, ds]);

  const empty = s.rowCount === 0 || s.total === 0;
  const stayName = ds.stayName;
  const legend = view$ ? [0, ...view$.thresholds] : [];

  return (
    <div className="page-map">
      <PageHeader
        no="05"
        en="Map"
        title="생활인구 지도"
        lead={`거주 시군구별 생활인구를 지도에 칠했습니다. 값 차이가 수천 배라 로그 눈금 7단계로 나눴고, 상위 ${FLOWS}곳에서 ${stayName}으로 오는 흐름을 선 굵기로 그렸습니다.`}
      />

      <section className="kpi-row" aria-label="지도 요약">
        <StatTile label="값이 있는 거주지" value={view$ ? `${fmtInt(view$.external.length)}곳` : '—'} sub={`${level === 'city' ? '시 단위' : '시군구'} · ${stayName} 자체 제외`} />
        <StatTile
          label="최대 유입지역"
          value={view$?.external[0] ? view$.external[0].u.full : '—'}
          sub={view$?.external[0] ? `${fmtInt(view$.external[0].value)}명 · 전체의 ${fmtPct(view$.external[0].value / s.total)}` : undefined}
        />
        <StatTile label="외부 유입 비중" value={fmtPct(k.externalShare)} sub={`${stayName} 거주자를 뺀 비중`} />
        <StatTile
          label="지도에 없는 값"
          value={view$ ? `${fmtInt(view$.unmappedValue)}명` : '—'}
          sub={
            base && base.unmapped.length
              ? `경계가 없는 코드: ${base.unmapped.map((i) => ds.regions[i].full + ' ' + ds.regions[i].code).join(', ')} — ‘시 단위’로 보면 합쳐집니다`
              : '모든 거주지가 지도에 있습니다'
          }
        />
      </section>

      <div className="grid">
        <Panel
          className="span-8 md-12"
          fig="01"
          title="거주지별 생활인구"
          subtitle={`진할수록 많습니다. ${stayName}(체류지)은 먹색, 굵은 선은 시도 경계입니다.${view === 'near' ? ` ‘${stayName} 주변’은 ${stayName} 중심에서 ${NEAR_KM}km 안의 지역에 맞춰 확대합니다.` : ''}`}
          tools={
            <>
              <Segmented
                options={[
                  { value: 'near', label: `${stayName} 주변` },
                  { value: 'nation', label: '전국' },
                ]}
                value={view}
                onChange={setView}
                label="보기 범위"
              />
              <Segmented
                options={[
                  { value: 'sigungu', label: '시군구' },
                  { value: 'city', label: '시 단위' },
                ]}
                value={level}
                onChange={setLevel}
                label="지도 단위"
              />
              <label className="check">
                <input type="checkbox" checked={showFlows} onChange={(e) => setShowFlows(e.target.checked)} />
                유입 흐름
              </label>
            </>
          }
          empty={empty}
          table={
            view$
              ? {
                  columns: [{ label: '순위', numeric: true }, { label: '거주지' }, { label: '권역' }, { label: '생활인구 (명)', numeric: true }, { label: '비중', numeric: true }, { label: '색 단계', numeric: true }],
                  rows: view$.ranked.map((x, i) => [
                    fmtInt(i + 1),
                    x.u.full,
                    x.u.zone,
                    fmtInt(x.value),
                    fmtPct(x.value / s.total),
                    x.u.isStay ? '체류지' : String(binOf(x.value, view$.thresholds)),
                  ]),
                }
              : undefined
          }
          foot={topo?.metadata?.attribution}
        >
          {error ? (
            <p className="panel-empty">{error}</p>
          ) : !view$ || !base ? (
            <p className="panel-empty">지도를 불러오는 중…</p>
          ) : (
            <ChoroplethMap
              areas={view$.areas}
              borders={base.borders}
              flows={showFlows ? view$.external.slice(0, FLOWS).map((x) => ({ key: x.u.key, value: x.value })) : []}
              focus={view === 'near' ? view$.focus : undefined}
              thresholds={view$.thresholds}
              highlight={hover}
              onHover={setHover}
              label={`거주지별 생활인구 지도 (${view === 'near' ? `${stayName} 주변` : '전국'}, ${level === 'city' ? '시 단위' : '시군구'})`}
              height={view === 'near' ? 620 : 720}
            />
          )}
        </Panel>

        <section className="panel span-4 md-12 map-side" aria-labelledby="map-side-title">
          <header className="panel-head">
            <div className="panel-heading">
              <p className="panel-fig">Legend · Top {LIST}</p>
              <h2 className="panel-title" id="map-side-title">
                범례와 상위 거주지
              </h2>
            </div>
          </header>
          {view$ && (
            <>
              <ul className="map-legend">
                {legend.map((t, i) => (
                  <li key={i}>
                    <span className={`key key-rect seq-bg-${i + 1}`} aria-hidden="true" />
                    {i === 0 ? `${fmtInt(legend[1] ?? 0)}명 이하` : i === legend.length - 1 ? `${fmtInt(t)}명 초과` : `${fmtInt(t)} ~ ${fmtInt(legend[i + 1])}명`}
                  </li>
                ))}
                <li>
                  <span className="key key-rect area-empty-swatch" aria-hidden="true" />값 없음
                </li>
                <li>
                  <span className="key key-rect area-stay-swatch" aria-hidden="true" />
                  {stayName} (체류지)
                </li>
                {showFlows && (
                  <li>
                    <span className="key key-line flow-swatch" aria-hidden="true" />
                    상위 {FLOWS}곳 → {stayName} 흐름 (굵을수록 많음)
                  </li>
                )}
              </ul>
              <p className="stacked-title map-side-sub">상위 {LIST}곳 · 마우스를 올리면 지도에 표시</p>
              <div>
                <BarList
                  label="지도 상위 거주지"
                  onActive={setHover}
                  items={view$.external.slice(0, LIST).map((x, i) => ({
                    key: x.u.key,
                    rank: i + 1,
                    label: x.u.label,
                    prefix: ds.sidos.find((sd) => sd.code === ds.regions[x.u.members[0]].sido)?.short,
                    value: x.value,
                    valueText: fmtInt(x.value),
                    shareText: fmtPct(x.value / s.total),
                    tooltip: [
                      { label: '명', value: fmtInt(x.value) },
                      { label: '전체 대비', value: fmtPct(x.value / s.total) },
                    ],
                  }))}
                />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
