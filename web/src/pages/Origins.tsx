import { useMemo, useState } from 'react';
import { BarList, type BarItem } from '../components/charts/BarList';
import { ColumnChart } from '../components/charts/ColumnChart';
import { StackedBar } from '../components/charts/StackedBar';
import { Icon } from '../components/ui/Icon';
import { StatTile } from '../components/ui/Metrics';
import { PageHeader, Segmented } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { age10Series, genderShares, kpis, summarize } from '../data/engine';
import { regionMask } from '../data/filters';
import { fmtInt, fmtPct, fmtRatio } from '../data/format';
import { concentration, ORIGIN_LEVELS, rankOrigins, type OriginLevel, type OriginRank } from '../data/origins';
import { periodSeries } from '../data/time';
import { useDataset } from '../state/DataProvider';
import { useFilters } from '../state/FilterProvider';

const PAGE = 20;
const CUMULATIVE_STEPS = [1, 3, 5, 10, 20, 50];
const GENDER_COLORS = ['var(--series-1)', 'var(--series-2)'];

function toItem(r: OriginRank, i: number, stayName: string): BarItem {
  return {
    key: r.key,
    rank: i + 1,
    label: r.label,
    prefix: r.prefix || undefined,
    tag: r.containsStay ? (r.members.length === 1 ? '자체' : `${stayName} 포함`) : undefined,
    value: r.value,
    valueText: fmtInt(r.value),
    shareText: fmtPct(r.share),
    muted: r.containsStay && r.members.length === 1,
    tooltip: [
      { label: '명', value: fmtInt(r.value) },
      { label: '전체 대비', value: fmtPct(r.share) },
      { label: '순위', value: `${fmtInt(i + 1)}위` },
    ],
  };
}

export function Origins() {
  const ds = useDataset();
  const { summary: s, filters, update } = useFilters();
  const [level, setLevel] = useState<OriginLevel>('sigungu');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [picked, setPicked] = useState<string | null>(null);

  const ranked = useMemo(() => rankOrigins(ds, s, level), [ds, s, level]);
  const sigungu = useMemo(() => rankOrigins(ds, s, 'sigungu'), [ds, s]);
  const sidos = useMemo(() => rankOrigins(ds, s, 'sido'), [ds, s]);
  const zones = useMemo(() => rankOrigins(ds, s, 'zone'), [ds, s]);
  const conc = useMemo(() => concentration(sigungu), [sigungu]);
  const k = useMemo(() => kpis(ds, s), [ds, s]);
  const empty = s.rowCount === 0 || s.total === 0;

  const q = query.trim();
  const listed = q ? ranked.filter((r) => r.full.includes(q) || r.label.includes(q) || r.key.startsWith(q)) : ranked;
  const rankOf = new Map(ranked.map((r, i) => [r.key, i]));

  // 상세: 고른 항목이 없거나 목록에서 사라졌으면 체류지 자체를 뺀 1위
  const selected = ranked.find((r) => r.key === picked) ?? ranked.find((r) => !r.containsStay) ?? ranked[0] ?? null;
  const globalMask = useMemo(() => regionMask(ds, filters.region), [ds, filters.region]);
  const detail = useMemo(() => {
    if (!selected) return null;
    const codes = selected.members.filter((i) => globalMask[i]).map((i) => ds.regions[i].code);
    const ds2 = summarize(ds, { ...filters, region: { kind: 'codes', codes, label: selected.full } });
    return { s: ds2, k: kpis(ds, ds2), age: age10Series(ds, ds2), gender: genderShares(ds, ds2), months: periodSeries(ds, ds2, 'month') };
  }, [ds, filters, selected, globalMask]);

  const adjacentShare = s.total > 0 ? ds.regions.reduce((n, r, i) => n + (r.adjacent ? s.byRegion[i] : 0), 0) / s.total : null;
  const adjacentNames = ds.regions.filter((r) => r.adjacent).map((r) => r.name);
  const external = sigungu.filter((r) => !r.containsStay && r.value > 0);
  const externalTotal = external.reduce((n, r) => n + r.value, 0);
  const cumulative = CUMULATIVE_STEPS.filter((n) => n <= Math.max(1, external.length)).map((n) => {
    const v = external.slice(0, n).reduce((x, r) => x + r.value, 0);
    return { n, value: v, share: externalTotal > 0 ? v / externalTotal : null };
  });

  return (
    <div className="page-origins">
      <PageHeader
        no="04"
        en="Origins"
        title="유입지역"
        lead={`어디에서 오는지 봅니다. 거주지 순위를 시군구·시·시도·권역 단위로 바꿔 보고, 순위에서 한 곳을 고르면 그 거주지의 연령·성별·월별 모습을 옆에 보여 줍니다.`}
      />

      <section className="kpi-row" aria-label="유입 지표">
        <StatTile label="유입 거주지 수" value={`${fmtInt(conc.count)}곳`} sub={`시군구 기준 · ${ds.stayName} 자체 제외 · 생활인구가 0보다 큰 곳`} />
        <StatTile label="상위 10곳 집중도" value={fmtPct(conc.top10)} sub={`외부 유입 합계 중 상위 10개 시군구 비중 · 1위만 ${fmtPct(conc.top1)}`} />
        <StatTile label="외부 유입 비중" value={fmtPct(k.externalShare)} sub={k.selfShare ? `나머지 ${fmtPct(k.selfShare)}는 ${ds.stayName} 거주자` : `${ds.stayName} 거주자 행 없음`} />
        <StatTile label={`${ds.stayName} 인접 시군 비중`} value={fmtPct(adjacentShare)} sub={adjacentNames.join(' · ')} />
      </section>

      <div className="grid">
        <Panel
          className="span-7 md-12"
          fig="01"
          title="거주지 순위"
          subtitle="줄을 누르면 오른쪽에 그 거주지의 상세가 나옵니다. ‘시 단위’는 일반구를 시로 합칩니다(예: 수원시 4개 구, 화성시)."
          tools={
            <Segmented
              options={ORIGIN_LEVELS}
              value={level}
              onChange={(v) => {
                setLevel(v);
                setLimit(PAGE);
                setPicked(null);
              }}
              label="묶는 단위"
            />
          }
          empty={empty}
          table={{
            columns: [{ label: '순위', numeric: true }, { label: '거주지' }, { label: '권역' }, { label: '생활인구 (명)', numeric: true }, { label: '비중', numeric: true }, { label: '원본 행 수', numeric: true }],
            rows: ranked.map((r, i) => [fmtInt(i + 1), r.full, r.zone || '—', fmtInt(r.value), fmtPct(r.share), fmtInt(r.rows)]),
          }}
          foot={`${fmtInt(listed.length)}곳 중 ${fmtInt(Math.min(limit, listed.length))}곳 표시`}
        >
          {(level === 'sigungu' || level === 'city') && (
            <div className="search search-inline">
              <Icon name="search" className="search-icon" />
              <input
                type="search"
                value={query}
                placeholder={`이름 검색 (예: ${ranked
                  .slice(0, 2)
                  .map((r) => r.label)
                  .join(', ')})`}
                aria-label="거주지 이름 검색"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(PAGE);
                }}
              />
            </div>
          )}
          {listed.length === 0 ? (
            <p className="empty-note">‘{q}’에 맞는 거주지가 없습니다.</p>
          ) : (
            <BarList
              items={listed.slice(0, limit).map((r) => toItem(r, rankOf.get(r.key)!, ds.stayName))}
              label="거주지 순위"
              selectedKey={selected?.key}
              onSelect={setPicked}
            />
          )}
          {listed.length > limit && (
            <button type="button" className="button more-button" onClick={() => setLimit((n) => n + PAGE)}>
              {fmtInt(Math.min(PAGE, listed.length - limit))}곳 더 보기
            </button>
          )}
        </Panel>

        <section className="panel span-5 md-12 detail" aria-labelledby="detail-title">
          <header className="panel-head">
            <div className="panel-heading">
              <p className="panel-fig">Fig. 02 · 선택한 거주지</p>
              <h2 className="panel-title" id="detail-title">
                {selected ? selected.full : '—'}
              </h2>
              {selected?.zone && <p className="panel-sub">{selected.zone}</p>}
            </div>
            {selected && (
              <div className="panel-tools">
                <button type="button" className="button" onClick={() => update({ region: selected.scope })}>
                  이 지역만 필터로 보기
                </button>
              </div>
            )}
          </header>
          {!selected || !detail || empty ? (
            <p className="panel-empty">선택한 조건에 맞는 데이터가 없습니다.</p>
          ) : (
            <div className="detail-body">
              <dl className="mini-stats">
                <div>
                  <dt>생활인구</dt>
                  <dd>{fmtInt(detail.s.total)}명</dd>
                </div>
                <div>
                  <dt>전체 대비</dt>
                  <dd>{fmtPct(s.total > 0 ? detail.s.total / s.total : null)}</dd>
                </div>
                <div>
                  <dt>순위</dt>
                  <dd>
                    {fmtInt((rankOf.get(selected.key) ?? 0) + 1)}위 / {fmtInt(ranked.length)}
                  </dd>
                </div>
                <div>
                  <dt>주말 ÷ 평일</dt>
                  <dd>{fmtRatio(detail.k.weekendRatio)}</dd>
                </div>
              </dl>
              <div className="detail-block">
                <p className="stacked-title">연령대 (10세)</p>
                <ColumnChart
                  height={170}
                  format={fmtInt}
                  label={`${selected.full} 연령대별 생활인구`}
                  columns={detail.age.map((a) => ({
                    key: a.key,
                    label: a.label,
                    shortLabel: a.label.replace('세 이상', '+').replace('대', '').replace('세', ''),
                    value: a.value,
                    tooltipTitle: `${selected.label} · ${a.label}`,
                    tooltip: [
                      { label: '명', value: fmtInt(a.value) },
                      { label: '이 거주지 안 비중', value: fmtPct(a.share) },
                    ],
                  }))}
                />
              </div>
              <div className="detail-block">
                <StackedBar title="성별" parts={detail.gender} colors={GENDER_COLORS} />
              </div>
              <div className="detail-block">
                <p className="stacked-title">월별 일평균</p>
                <ColumnChart
                  height={150}
                  format={fmtInt}
                  label={`${selected.full} 월별 일평균`}
                  columns={detail.months.map((m) => ({
                    key: m.key,
                    label: m.label,
                    value: m.dailyMean,
                    tooltipTitle: `${selected.label} · ${m.label}`,
                    tooltip: [
                      { label: '일평균 (명)', value: fmtInt(m.dailyMean) },
                      { label: '합계 (명)', value: fmtInt(m.sum) },
                    ],
                    emptyNote: '데이터 없음',
                  }))}
                />
              </div>
            </div>
          )}
        </section>

        <Panel
          className="span-4"
          fig="03"
          title="시도별 구성"
          subtitle="거주지 시도별 생활인구와 비중"
          empty={empty}
          table={{
            columns: [{ label: '시도' }, { label: '생활인구 (명)', numeric: true }, { label: '비중', numeric: true }],
            rows: sidos.map((r) => [r.label, fmtInt(r.value), fmtPct(r.share)]),
          }}
        >
          <BarList items={sidos.map((r, i) => ({ ...toItem(r, i, ds.stayName), rank: undefined, muted: false, tag: undefined }))} label="시도별 구성" />
        </Panel>

        <Panel
          className="span-4"
          fig="04"
          title="권역별 구성"
          subtitle={`${ds.stayName} 기준 권역. ${ds.stayName} 자체는 회색입니다.`}
          empty={empty}
          table={{
            columns: [{ label: '권역' }, { label: '생활인구 (명)', numeric: true }, { label: '비중', numeric: true }],
            rows: zones.map((r) => [r.label, fmtInt(r.value), fmtPct(r.share)]),
          }}
        >
          <BarList items={zones.map((r, i) => ({ ...toItem(r, i, ds.stayName), rank: undefined, tag: undefined }))} label="권역별 구성" />
        </Panel>

        <Panel
          className="span-4"
          fig="05"
          title="상위 N곳 누적 비중"
          subtitle={`외부 유입(${ds.stayName} 자체 제외) 중 상위 시군구가 차지하는 몫. 빨리 100%에 가까워질수록 소수 지역에 몰려 있습니다.`}
          empty={empty || external.length === 0}
          table={{
            columns: [{ label: '상위' }, { label: '누적 생활인구 (명)', numeric: true }, { label: '누적 비중', numeric: true }],
            rows: cumulative.map((c) => [`${c.n}곳`, fmtInt(c.value), fmtPct(c.share)]),
          }}
          foot={conc.hhi !== null ? `허핀달-허쉬만 지수(HHI) ${fmtInt(conc.hhi)} — 0에 가까울수록 고르게, 10,000에 가까울수록 한곳에 몰려 있습니다.` : undefined}
        >
          <BarList
            items={cumulative.map((c) => ({
              key: String(c.n),
              label: `상위 ${c.n}곳`,
              value: c.share ?? 0,
              valueText: fmtInt(c.value),
              shareText: fmtPct(c.share),
              tooltip: [
                { label: '누적 명', value: fmtInt(c.value) },
                { label: '외부 유입 대비', value: fmtPct(c.share) },
              ],
            }))}
            label="상위 N곳 누적 비중"
            max={1}
          />
        </Panel>
      </div>
    </div>
  );
}
