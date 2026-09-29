import { useMemo } from 'react';
import { BarList, type BarItem } from '../components/charts/BarList';
import { ColumnChart, type Column } from '../components/charts/ColumnChart';
import { Legend } from '../components/charts/Legend';
import { StackedBar } from '../components/charts/StackedBar';
import { TrendChart } from '../components/charts/TrendChart';
import { Icon } from '../components/ui/Icon';
import { HeroMetric, StatTile } from '../components/ui/Metrics';
import { Panel } from '../components/ui/Panel';
import { dotDay, shortDay, WEEKDAY_LABELS } from '../data/dates';
import {
  dailySeries,
  genderShares,
  kpis,
  lifeStageShares,
  monthlySeries,
  rankRegions,
  weekdaySeries,
  zoneShares,
} from '../data/engine';
import { describeAges, describePeriod, describeRegion } from '../data/filters';
import { DASH, fmtCompact, fmtDecimal, fmtInt, fmtPct, fmtRatio } from '../data/format';
import { useDataset } from '../state/DataProvider';
import { useFilters } from '../state/FilterProvider';

const TOP_N = 10;
const GENDER_COLORS = ['var(--series-1)', 'var(--series-2)'];
const STAGE_COLORS = ['var(--ord-1)', 'var(--ord-2)', 'var(--ord-3)', 'var(--ord-4)'];

export function Overview() {
  const ds = useDataset();
  const { summary: s, filters, reset } = useFilters();

  const view = useMemo(() => {
    const daily = dailySeries(ds, s);
    return {
      k: kpis(ds, s),
      daily,
      months: monthlySeries(ds, s),
      week: weekdaySeries(ds, s),
      gender: genderShares(ds, s),
      stages: lifeStageShares(ds, s),
      zones: zoneShares(ds, s),
      ranked: rankRegions(ds, s),
    };
  }, [ds, s]);
  const { k, daily, months, week, gender, stages, zones, ranked } = view;
  const empty = s.rowCount === 0 || s.total === 0;
  const genderLabel = filters.gender === 'all' ? '전체 성별' : ds.genders.find((g) => g.code === filters.gender)?.label;
  const condition = [describePeriod(ds, filters), genderLabel, describeAges(ds, filters.ages), describeRegion(ds, filters.region)];
  const gapDays = daily.filter((d) => !d.hasData).length;

  // ── 그래프 데이터 ─────────────────────────────────────────────────────────
  const monthColumns: Column[] = months.map((m) => ({
    key: m.key,
    label: m.label,
    value: m.dailyMean,
    tooltipTitle: `${m.label} (${m.dataDays}/${m.periodDays}일)`,
    tooltip: [
      { label: '일평균', value: fmtInt(m.dailyMean) },
      { label: '합계', value: fmtInt(m.sum) },
    ],
    emptyNote: '데이터 없음',
  }));

  const weekColumns: Column[] = week.map((w) => ({
    key: String(w.weekday),
    label: w.label,
    value: w.dailyMean,
    emphasis: w.isWeekend,
    tooltipTitle: `${w.label}요일 (${w.dataDays}일)`,
    tooltip: [
      { label: '일평균', value: fmtInt(w.dailyMean) },
      { label: '합계', value: fmtInt(w.sum) },
    ],
  }));

  const regionItems: BarItem[] = ranked.slice(0, TOP_N).map((r, i) => ({
    key: r.code,
    rank: i + 1,
    label: r.name,
    prefix: r.sidoShort,
    tag: r.isStay ? '자체' : undefined,
    value: r.value,
    valueText: fmtInt(r.value),
    shareText: fmtPct(r.share),
    muted: r.isStay,
    tooltip: [
      { label: '체류인구 합계', value: fmtInt(r.value) },
      { label: '전체 대비', value: fmtPct(r.share) },
      { label: `권역 · ${r.zone}`, value: r.code },
    ],
  }));

  const zoneItems: BarItem[] = zones.map((z) => ({
    key: z.key,
    label: z.label,
    value: z.value,
    valueText: fmtInt(z.value),
    shareText: fmtPct(z.share),
    muted: z.key === ds.regions[ds.stayRegionIndex].zone,
    tooltip: [
      { label: '체류인구 합계', value: fmtInt(z.value) },
      { label: '전체 대비', value: fmtPct(z.share) },
    ],
  }));

  const adjacent = ranked.filter((r) => ds.regions[r.index].adjacent);
  const adjacentItems: BarItem[] = adjacent.map((r) => ({
    key: r.code,
    label: r.name,
    prefix: r.sidoShort,
    value: r.value,
    valueText: fmtInt(r.value),
    shareText: fmtPct(r.share),
    tooltip: [
      { label: '체류인구 합계', value: fmtInt(r.value) },
      { label: '전체 대비', value: fmtPct(r.share) },
    ],
  }));

  const notes = [
    gapDays > 0 && `선택 기간 중 ${gapDays}일은 원본에 데이터가 없어 빈 구간으로 두었습니다(0으로 채우거나 보간하지 않음). 일평균은 데이터가 있는 날로만 나눕니다.`,
    s.cappedRows > 0 &&
      `체류인구수가 ${fmtDecimal(ds.cap100 / 100)}로 같은 행 ${fmtInt(s.cappedRows)}개가 합계의 ${fmtPct(k.cappedShare)}를 차지합니다. 상한에서 잘라 낸 값으로 보입니다.`,
    (k.selfShare ?? 0) > 0 &&
      `거주지가 김천시(체류지와 같음)인 행이 합계의 ${fmtPct(k.selfShare)}입니다. 공식 체류인구는 보통 그 지역 주민을 빼고 셉니다. ‘외부 유입만’으로 따로 볼 수 있습니다.`,
    k.zeroRatio !== null &&
      `체류인구수가 0인 행이 ${fmtPct(k.zeroRatio)}입니다. 0이 아닌 값은 모두 3 이상이어서, 0은 ‘3 미만’을 가린 값일 수 있습니다.`,
    '누적 체류인구는 날짜별 값을 더한 연인원입니다. 같은 사람이 여러 날 머물면 여러 번 세어지므로 실제 인원이 아닙니다.',
  ].filter(Boolean) as string[];

  return (
    <div className="overview">
      <header className="page-head">
        <div className="page-head-main">
          <p className="eyebrow">01 — Overview</p>
          <h1 className="page-title">김천시 체류인구 개요</h1>
          <p className="page-lead">
            경상북도 김천시에 하루 3시간 이상 머문 사람들을 거주지·성별·연령대별로 센 <strong>합성데이터</strong>입니다. 위쪽 조건을
            바꾸면 이 화면의 모든 숫자와 그래프가 같은 조건으로 다시 계산됩니다.
          </p>
          <p className="condition" aria-label="현재 조건">
            {condition.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </p>
        </div>
        <dl className="page-meta">
          <div>
            <dt>체류지</dt>
            <dd>
              {ds.stayRegion.name} <span className="mono muted">{ds.stayRegion.code}</span>
            </dd>
          </div>
          <div>
            <dt>기간</dt>
            <dd className="mono">
              {dotDay(ds.calendar[0])} – {dotDay(ds.calendar[ds.calendar.length - 1]).slice(5)}
            </dd>
          </div>
          <div>
            <dt>원본</dt>
            <dd>
              <span className="mono">{fmtInt(ds.rows.n)}</span>행 · 거주지 <span className="mono">{ds.regions.length}</span>개 시군구
            </dd>
          </div>
          <div>
            <dt>구분</dt>
            <dd>합성데이터 · 공식통계 아님</dd>
          </div>
        </dl>
      </header>

      {empty && (
        <div className="empty-banner" role="status">
          <Icon name="info" />
          <p>
            선택한 조건에 맞는 데이터가 없습니다. 기간(5월은 데이터 없음)이나 거주지역을 바꿔 보세요.
          </p>
          <button type="button" className="button" onClick={reset}>
            조건 초기화
          </button>
        </div>
      )}

      <section className="kpis" aria-label="핵심 지표">
        <HeroMetric
          label="일평균 체류인구"
          value={fmtInt(k.dailyMean)}
          unit="명"
          sub={
            <>
              데이터가 있는 <span className="mono">{s.dataDays}</span>일 기준
              {s.dataDays !== s.periodDays && (
                <>
                  {' '}
                  · 선택 기간 <span className="mono">{s.periodDays}</span>일
                </>
              )}
            </>
          }
          trend={daily.map((d) => d.ma7)}
          trendLabel="7일 이동평균 추이"
        />
        <div className="stat-grid">
          <StatTile label="누적 체류인구" value={fmtCompact(k.total)} unit="명" sub="날짜별 값을 더한 연인원 · 실제 인원 아님" />
          <StatTile
            label="외부 유입 비중"
            value={fmtPct(k.externalShare)}
            sub={k.selfShare ? `나머지 ${fmtPct(k.selfShare)}는 김천시 거주자` : '김천시 거주자 행 없음'}
          />
          <StatTile
            label="최대 유입지역"
            value={k.topOrigin ? `${k.topOrigin.sidoShort} ${k.topOrigin.name}` : DASH}
            sub={k.topOrigin ? `전체의 ${fmtPct(k.topOrigin.share)} · 김천시 자체 제외` : '외부 유입 없음'}
          />
          <StatTile
            label="주말 ÷ 평일"
            value={fmtRatio(k.weekendRatio)}
            sub={`일평균 주말 ${fmtCompact(k.weekendMean)} · 평일 ${fmtCompact(k.weekdayMean)}`}
          />
          <StatTile
            label="여성 비중"
            value={fmtPct(k.femaleShare)}
            sub={filters.gender === 'all' ? `남성 ${fmtPct(k.femaleShare === null ? null : 1 - k.femaleShare)}` : '성별 조건이 걸려 있음'}
          />
          <StatTile
            label="가장 큰 생애단계"
            value={k.topLifeStage?.label ?? DASH}
            sub={k.topLifeStage ? `${k.topLifeStage.note} · 전체의 ${fmtPct(k.topLifeStage.share)}` : undefined}
          />
        </div>
      </section>

      <div className="grid">
        <Panel
          className="span-12"
          fig="01"
          title="일별 체류인구 추이"
          subtitle="날짜별 합계와 최근 7일(데이터 있는 날) 평균. 날짜마다 기록된 행 수가 228~1,263행으로 달라 하루하루의 오르내림이 큽니다."
          empty={empty}
          legend={
            <Legend
              items={[
                { label: '일별 합계', color: 'var(--deemph)', kind: 'rect' },
                { label: '7일 이동평균', color: 'var(--series-1)', kind: 'line' },
                ...(gapDays > 0 ? [{ label: '데이터 없음', color: 'var(--nodata)', kind: 'band' as const }] : []),
              ]}
            />
          }
          table={{
            columns: [{ label: '날짜' }, { label: '일별 합계', numeric: true }, { label: '7일 이동평균', numeric: true }],
            rows: daily.map((d) => [shortDay(d.day, true), d.hasData ? fmtInt(d.value) : '데이터 없음', fmtInt(d.ma7)]),
          }}
        >
          <TrendChart points={daily} label={`일별 체류인구 추이, ${condition.join(', ')}`} />
        </Panel>

        <Panel
          className="span-4"
          fig="02"
          title="월별 일평균"
          subtitle="월 합계 ÷ 그달의 데이터 있는 날 수"
          empty={empty}
          table={{
            columns: [{ label: '월' }, { label: '데이터 일수', numeric: true }, { label: '합계', numeric: true }, { label: '일평균', numeric: true }],
            rows: months.map((m) => [m.label, `${m.dataDays}/${m.periodDays}`, fmtInt(m.sum), m.dailyMean === null ? '데이터 없음' : fmtInt(m.dailyMean)]),
          }}
        >
          <ColumnChart columns={monthColumns} format={fmtCompact} height={260} label="월별 일평균 체류인구" />
        </Panel>

        <Panel
          className="span-4"
          fig="03"
          title="요일별 일평균"
          subtitle="주말(토·일)을 강조했습니다."
          empty={empty}
          table={{
            columns: [{ label: '요일' }, { label: '데이터 일수', numeric: true }, { label: '합계', numeric: true }, { label: '일평균', numeric: true }],
            rows: week.map((w) => [`${WEEKDAY_LABELS[w.weekday]}요일`, String(w.dataDays), fmtInt(w.sum), fmtInt(w.dailyMean)]),
          }}
        >
          <ColumnChart columns={weekColumns} format={fmtCompact} height={260} label="요일별 일평균 체류인구" />
        </Panel>

        <Panel
          className="span-4 md-12"
          fig="04"
          title="성별 · 생애단계 구성"
          subtitle="체류인구 합계 대비 비중"
          empty={empty}
          table={{
            columns: [{ label: '구분' }, { label: '항목' }, { label: '합계', numeric: true }, { label: '비중', numeric: true }],
            rows: [
              ...gender.map((g) => ['성별', g.label, fmtInt(g.value), fmtPct(g.share)]),
              ...stages.map((l) => ['생애단계', `${l.label} (${l.note})`, fmtInt(l.value), fmtPct(l.share)]),
            ],
          }}
        >
          <div className="stack-pair">
            <StackedBar title="성별" parts={gender} colors={GENDER_COLORS} />
            <StackedBar title="생애단계" parts={stages} colors={STAGE_COLORS} />
          </div>
        </Panel>

        <Panel
          className="span-7 md-12"
          fig="05"
          title={`유입지역 상위 ${TOP_N}`}
          subtitle="거주 시군구별 체류인구 합계와 전체 대비 비중. 김천시 자체(거주지 = 체류지)는 회색으로 구분했습니다."
          empty={empty}
          table={{
            columns: [{ label: '순위', numeric: true }, { label: '거주지' }, { label: '권역' }, { label: '합계', numeric: true }, { label: '비중', numeric: true }],
            rows: ranked.map((r, i) => [String(i + 1), r.full, r.zone, fmtInt(r.value), fmtPct(r.share)]),
          }}
          foot={ranked.length > TOP_N ? `전체 ${ranked.length}개 시군구 중 상위 ${TOP_N}개. 표 보기에서 전체 순위를 볼 수 있습니다.` : undefined}
        >
          <BarList items={regionItems} label={`유입지역 상위 ${TOP_N}`} />
        </Panel>

        <Panel
          className="span-5 md-12"
          fig="06"
          title="김천 기준 권역별 구성"
          subtitle="김천시와 경계를 맞댄 7개 시군을 ‘인접 시군’으로 묶었습니다."
          empty={empty}
          table={{
            columns: [{ label: '구분' }, { label: '항목' }, { label: '합계', numeric: true }, { label: '비중', numeric: true }],
            rows: [
              ...zones.map((z) => ['권역', z.label, fmtInt(z.value), fmtPct(z.share)]),
              ...adjacent.map((r) => ['인접 시군', r.full, fmtInt(r.value), fmtPct(r.share)]),
            ],
          }}
        >
          <BarList items={zoneItems} label="권역별 구성" />
          {adjacentItems.length > 0 && (
            <div className="sublist">
              <p className="stacked-title">인접 시군 {adjacentItems.length}곳</p>
              <BarList items={adjacentItems} label="김천 인접 시군별 체류인구" />
            </div>
          )}
        </Panel>

        <section className="panel span-12 notes" aria-labelledby="notes-title">
          <header className="panel-head">
            <div className="panel-heading">
              <p className="panel-fig">Notes</p>
              <h2 className="panel-title" id="notes-title">
                이 화면을 읽을 때
              </h2>
            </div>
          </header>
          <ol className="notes-list">
            <li>
              <strong>합성데이터입니다.</strong> 공식통계가 아니며 김천시의 실제 체류인구·생활인구를 나타내지 않습니다.
            </li>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
