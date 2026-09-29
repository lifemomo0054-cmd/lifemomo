import { useMemo } from 'react';
import { BarList, type BarItem } from '../components/charts/BarList';
import { ColumnChart, type Column } from '../components/charts/ColumnChart';
import { GenderComposition } from '../components/charts/GenderComposition';
import { Legend } from '../components/charts/Legend';
import { TrendChart } from '../components/charts/TrendChart';
import { Icon } from '../components/ui/Icon';
import { StatTile } from '../components/ui/Metrics';
import { Panel } from '../components/ui/Panel';
import { dotDay, shortDay, WEEKDAY_LABELS } from '../data/dates';
import { age10Series, dailySeries, genderShares, kpis, rankRegions, weekdaySeries } from '../data/engine';
import { ageLabel, describeAges, describePeriod, describeRegion } from '../data/filters';
import { DASH, fmtInt, fmtNum, fmtPct } from '../data/format';
import { useDataset } from '../state/DataProvider';
import { useFilters } from '../state/FilterProvider';

const TOP_N = 10;
const GENDER_COLORS = ['var(--series-1)', 'var(--series-2)'];

/**
 * 모든 숫자·그래프는 web/public/data/population.json(전처리 결과에서 만든 파일)을
 * 현재 필터로 집계한 값이다. 이 파일 안에는 데이터 값을 적지 않는다.
 */
export function Overview() {
  const ds = useDataset();
  const { summary: s, filters, reset } = useFilters();

  const view = useMemo(
    () => ({
      k: kpis(ds, s),
      daily: dailySeries(ds, s),
      week: weekdaySeries(ds, s),
      gender: genderShares(ds, s),
      age10: age10Series(ds, s),
      ranked: rankRegions(ds, s),
    }),
    [ds, s],
  );
  const { k, daily, week, gender, age10, ranked } = view;

  // 문구에 쓰는 원본 특성도 데이터 파일에서 계산한다
  const rowsPerDay = useMemo(() => ({ min: Math.min(...ds.rowsPerDate), max: Math.max(...ds.rowsPerDate) }), [ds]);
  const openAge = ds.ages.find((a) => a.band === null);

  const empty = s.rowCount === 0 || s.total === 0;
  const genderLabel = filters.gender === 'all' ? '전체 성별' : ds.genders.find((g) => g.code === filters.gender)?.label;
  const condition = [describePeriod(ds, filters), genderLabel, describeAges(ds, filters.ages), describeRegion(ds, filters.region)];
  const gapDays = daily.filter((d) => !d.hasData).length;
  const agesFiltered = filters.ages.length > 0;

  // ── 그래프 데이터 ─────────────────────────────────────────────────────────
  const ageColumns: Column[] = age10.map((a) => ({
    key: a.key,
    label: a.label,
    shortLabel: a.label.replace('세 이상', '+').replace('대', '').replace('세', ''),
    value: a.value,
    tooltipTitle: a.label,
    tooltip: [
      { label: '명', value: fmtInt(a.value) },
      { label: '전체 대비', value: fmtPct(a.share) },
      { label: '원본 구간', value: a.ages.map(ageLabel).join(', ') },
    ],
  }));

  const weekColumns: Column[] = week.map((w) => ({
    key: String(w.weekday),
    label: w.label,
    value: w.dailyMean,
    emphasis: w.isWeekend,
    tooltipTitle: `${w.label}요일 · 데이터 ${w.dataDays}일`,
    tooltip: [
      { label: '일평균 (명)', value: fmtInt(w.dailyMean) },
      { label: '합계 (명)', value: fmtInt(w.sum) },
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
      { label: '명', value: fmtInt(r.value) },
      { label: '전체 대비', value: fmtPct(r.share) },
      { label: r.zone, value: r.code },
    ],
  }));

  const notes = [
    gapDays > 0 &&
      `선택 기간 중 ${fmtInt(gapDays)}일은 원본에 데이터가 없어 빈 구간으로 두었습니다(0으로 채우거나 보간하지 않음). 일평균은 데이터가 있는 날로만 나눕니다.`,
    s.cappedRows > 0 &&
      `생활인구가 ${fmtNum(ds.cap100 / 100)}로 같은 행 ${fmtInt(s.cappedRows)}개가 합계의 ${fmtPct(k.cappedShare)}를 차지합니다. 상한에서 잘라 낸 값으로 보입니다.`,
    (k.selfShare ?? 0) > 0 &&
      `거주지가 ${ds.stayName}(체류지와 같음)인 행이 합계의 ${fmtPct(k.selfShare)}입니다. 공식 체류인구는 보통 그 지역 주민을 빼고 셉니다. 거주지역 필터의 ‘외부 유입만’으로 따로 볼 수 있습니다.`,
    k.zeroRatio !== null &&
      `생활인구가 0인 행이 ${fmtPct(k.zeroRatio)}입니다. 0이 아닌 값은 모두 ${fmtNum(ds.minPositive100 / 100)} 이상이어서, 0은 그보다 작은 값을 가린 것일 수 있습니다.`,
    '총 생활인구는 날짜별 값을 더한 연인원입니다. 같은 사람이 여러 날 머물면 여러 번 세어지므로 실제 인원이 아닙니다.',
  ].filter(Boolean) as string[];

  return (
    <div className="overview">
      <header className="page-head">
        <div className="page-head-main">
          <p className="eyebrow">01 — Overview</p>
          <h1 className="page-title">{ds.stayName} 생활인구 개요</h1>
          <p className="page-lead">
            {ds.stayRegion.name}의 {ds.measure}를 거주지·성별·연령대별로 집계했습니다. 위쪽 조건을 바꾸면 모든 지표와 그래프가 같은
            조건으로 다시 계산됩니다.
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
              <span className="mono">{fmtInt(ds.rows.n)}</span>행 · 거주지 <span className="mono">{fmtInt(ds.regions.length)}</span>개 시군구
            </dd>
          </div>
          <div>
            <dt>데이터 파일</dt>
            <dd>
              <span className="mono">data/population.json</span>
              <span className="meta-sub">
                전처리 결과에서 생성 · 원본 SHA-256 <span className="mono">{ds.source.sha256.slice(0, 12)}…</span>
              </span>
            </dd>
          </div>
        </dl>
      </header>

      {empty && (
        <div className="empty-banner" role="status">
          <Icon name="info" />
          <p>선택한 조건에 맞는 데이터가 없습니다. 기간(데이터가 없는 날 포함)이나 거주지역을 바꿔 보세요.</p>
          <button type="button" className="button" onClick={reset}>
            조건 초기화
          </button>
        </div>
      )}

      <section className="kpi-row" aria-label="핵심 지표">
        <StatTile label="총 생활인구" value={fmtInt(k.total)} unit="명" sub="날짜별 값을 더한 연인원 · 실제 인원 아님" />
        <StatTile
          label="일평균 생활인구"
          value={fmtInt(k.dailyMean)}
          unit="명"
          sub={
            <>
              데이터가 있는 {fmtInt(s.dataDays)}일 기준
              {s.dataDays !== s.periodDays && ` · 선택 기간 ${fmtInt(s.periodDays)}일`}
            </>
          }
          trend={daily.map((d) => d.ma7)}
          trendLabel="7일 이동평균 추이"
        />
        <StatTile
          label="주요 연령대"
          value={k.topAge10?.label ?? DASH}
          sub={k.topAge10 ? `${fmtInt(k.topAge10.value)}명 · 전체의 ${fmtPct(k.topAge10.share)}` : undefined}
        />
        <StatTile
          label="주요 유입지역"
          value={k.topOrigin ? `${k.topOrigin.sidoShort} ${k.topOrigin.name}` : DASH}
          sub={
            k.topOrigin
              ? `${fmtInt(k.topOrigin.value)}명 · 전체의 ${fmtPct(k.topOrigin.share)} · ${ds.stayName} 자체 제외`
              : '외부 유입 없음'
          }
        />
      </section>

      <div className="grid">
        <Panel
          className="span-12"
          fig="01"
          title="생활인구 시간 추이"
          subtitle={`날짜별 합계와 최근 7일(데이터 있는 날) 평균입니다. 날짜마다 기록된 원본 행 수가 ${fmtInt(rowsPerDay.min)}~${fmtInt(rowsPerDay.max)}행으로 달라 하루하루의 오르내림이 큽니다.`}
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
            columns: [{ label: '날짜' }, { label: '일별 합계 (명)', numeric: true }, { label: '7일 이동평균 (명)', numeric: true }],
            rows: daily.map((d) => [shortDay(d.day, true), d.hasData ? fmtInt(d.value) : '데이터 없음', fmtInt(d.ma7)]),
          }}
        >
          <TrendChart points={daily} label={`생활인구 시간 추이, ${condition.join(', ')}`} />
        </Panel>

        <Panel
          className="span-7"
          fig="02"
          title="연령별 생활인구"
          subtitle={
            <>
              10세 단위 합계입니다.{openAge && ` ${ageLabel(openAge.code)}은 상한이 없는 구간입니다.`}
              {agesFiltered && ' 연령 조건이 걸려 있어 고른 연령대만 포함됩니다.'}
            </>
          }
          empty={empty}
          table={{
            columns: [{ label: '연령대' }, { label: '원본 구간' }, { label: '생활인구 (명)', numeric: true }, { label: '비중', numeric: true }],
            rows: age10.map((a) => [a.label, a.ages.map(ageLabel).join(', '), fmtInt(a.value), fmtPct(a.share)]),
          }}
        >
          <ColumnChart columns={ageColumns} format={fmtInt} height={400} label="연령별 생활인구" />
        </Panel>

        <Panel
          className="span-5"
          fig="03"
          title="성별 구성"
          subtitle="전체와 연령대별 남녀 비중"
          empty={empty}
          legend={<Legend items={ds.genders.map((g, i) => ({ label: g.label, color: GENDER_COLORS[i], kind: 'rect' as const }))} />}
          table={{
            columns: [
              { label: '연령대' },
              ...ds.genders.map((g) => ({ label: `${g.label} (명)`, numeric: true })),
              ...ds.genders.map((g) => ({ label: `${g.label} 비중`, numeric: true })),
            ],
            rows: [
              ['전체', ...gender.map((g) => fmtInt(g.value)), ...gender.map((g) => fmtPct(g.share))],
              ...age10.map((a) => [a.label, ...a.byGender.map((g) => fmtInt(g.value)), ...a.byGender.map((g) => fmtPct(g.share))]),
            ],
          }}
        >
          <GenderComposition overall={gender} byAge={age10} colors={GENDER_COLORS} />
        </Panel>

        <Panel
          className="span-7"
          fig="04"
          title={`유입지역 TOP ${TOP_N}`}
          subtitle={`거주 시군구별 생활인구 합계와 전체 대비 비중입니다. ${ds.stayName} 자체(거주지 = 체류지)는 회색으로 구분했습니다.`}
          empty={empty}
          table={{
            columns: [
              { label: '순위', numeric: true },
              { label: '거주지' },
              { label: '권역' },
              { label: '생활인구 (명)', numeric: true },
              { label: '비중', numeric: true },
            ],
            rows: ranked.map((r, i) => [fmtInt(i + 1), r.full, r.zone, fmtInt(r.value), fmtPct(r.share)]),
          }}
          foot={ranked.length > TOP_N ? `전체 ${fmtInt(ranked.length)}개 시군구 중 상위 ${TOP_N}개. 표 보기에서 전체 순위를 볼 수 있습니다.` : undefined}
        >
          <BarList items={regionItems} label={`유입지역 TOP ${TOP_N}`} />
        </Panel>

        <Panel
          className="span-5"
          fig="05"
          title="요일별 생활인구"
          subtitle="요일별 일평균(합계 ÷ 그 요일의 데이터 있는 날 수). 주말(토·일)을 강조했습니다."
          empty={empty}
          table={{
            columns: [{ label: '요일' }, { label: '데이터 일수', numeric: true }, { label: '합계 (명)', numeric: true }, { label: '일평균 (명)', numeric: true }],
            rows: week.map((w) => [`${WEEKDAY_LABELS[w.weekday]}요일`, fmtInt(w.dataDays), fmtInt(w.sum), fmtInt(w.dailyMean)]),
          }}
        >
          <ColumnChart columns={weekColumns} format={fmtInt} height={360} label="요일별 일평균 생활인구" />
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
              <strong>합성데이터입니다.</strong> 공식통계가 아니며 {ds.stayName}의 실제 생활인구를 나타내지 않습니다.
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
