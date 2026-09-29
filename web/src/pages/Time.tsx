import { useMemo, useState } from 'react';
import { BarList, type BarItem } from '../components/charts/BarList';
import { ColumnChart, type Column } from '../components/charts/ColumnChart';
import { Heatmap } from '../components/charts/Heatmap';
import { Legend } from '../components/charts/Legend';
import { GroupedColumns } from '../components/charts/MultiColumns';
import { TrendChart } from '../components/charts/TrendChart';
import { StatTile } from '../components/ui/Metrics';
import { PageHeader, Segmented, useConditionLabels } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { dotDay, shortDay, WEEKDAY_LABELS } from '../data/dates';
import { dailySeries, kpis } from '../data/engine';
import { fmtDecimal, fmtInt, fmtPct, fmtRatio } from '../data/format';
import { dailyVariation, monthChanges, periodSeries, rankDays, weekdayMonthMatrix, weekendByMonth, type Granularity } from '../data/time';
import { useDataset } from '../state/DataProvider';
import { useFilters } from '../state/FilterProvider';

const UNITS: { value: Granularity; label: string }[] = [
  { value: 'day', label: '일' },
  { value: 'week', label: '주' },
  { value: 'month', label: '월' },
];
const TOP_DAYS = 10;

function signedPct(v: number | null): string {
  return v === null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
}

export function Time() {
  const ds = useDataset();
  const { summary: s } = useFilters();
  const condition = useConditionLabels();
  const [unit, setUnit] = useState<Granularity>('week');

  const v = useMemo(() => {
    const months = periodSeries(ds, s, 'month');
    return {
      k: kpis(ds, s),
      daily: dailySeries(ds, s),
      buckets: periodSeries(ds, s, unit === 'day' ? 'week' : unit),
      months,
      changes: monthChanges(months),
      matrix: weekdayMonthMatrix(ds, s),
      split: weekendByMonth(ds, s),
      days: rankDays(ds, s),
      cv: dailyVariation(ds, s),
    };
  }, [ds, s, unit]);
  const { k, daily, buckets, changes, matrix, split, days, cv } = v;
  const empty = s.rowCount === 0 || s.total === 0;
  const peak = days[0];
  const low = days[days.length - 1];

  const bucketColumns: Column[] = buckets.map((b) => ({
    key: b.key,
    label: b.label,
    shortLabel: unit === 'week' ? shortDay(b.start) : b.label,
    value: b.dailyMean,
    tooltipTitle: b.start === b.end ? shortDay(b.start, true) : `${dotDay(b.start).slice(5)} – ${dotDay(b.end).slice(5)}`,
    tooltip: [
      { label: '일평균 (명)', value: fmtInt(b.dailyMean) },
      { label: '합계 (명)', value: fmtInt(b.sum) },
      { label: '데이터 있는 날', value: `${b.dataDays}/${b.periodDays}일` },
    ],
    emptyNote: '데이터 없음',
  }));

  const monthColumns: Column[] = changes.map((c, i) => ({
    key: c.key,
    label: c.label,
    value: c.dailyMean,
    tooltipTitle: c.label,
    tooltip: [
      { label: '일평균 (명)', value: fmtInt(c.dailyMean) },
      { label: c.prevLabel ? `${c.prevLabel} 대비` : '앞 달 비교 없음', value: signedPct(c.change) },
      { label: '데이터 있는 날', value: `${v.months[i].dataDays}/${v.months[i].periodDays}일` },
    ],
    emptyNote: '데이터 없음',
  }));

  const dayItems: BarItem[] = days.slice(0, TOP_DAYS).map((d, i) => ({
    key: d.day,
    rank: i + 1,
    label: shortDay(d.day, true),
    value: d.value,
    valueText: fmtInt(d.value),
    shareText: fmtPct(s.total > 0 ? d.value / s.total : null),
    muted: d.weekday < 5,
    tooltip: [
      { label: '명', value: fmtInt(d.value) },
      { label: '기간 합계 대비', value: fmtPct(s.total > 0 ? d.value / s.total : null) },
      { label: '그날 원본 행 수', value: fmtInt(d.rows) },
    ],
  }));

  return (
    <div className="page-time">
      <PageHeader
        no="02"
        en="Temporal"
        title="시간 분석"
        lead="언제 많이 머무는지 봅니다. 일·주·월 단위 추이, 요일과 달의 조합, 주말 효과, 생활인구가 특히 많은 날을 같은 조건으로 계산합니다."
      />

      <section className="kpi-row" aria-label="시간 지표">
        <StatTile
          label="가장 많은 날"
          value={peak ? shortDay(peak.day, true) : '—'}
          sub={peak ? `${fmtInt(peak.value)}명 · 그날 원본 ${fmtInt(peak.rows)}행` : undefined}
        />
        <StatTile
          label="가장 적은 날"
          value={low ? shortDay(low.day, true) : '—'}
          sub={low ? `${fmtInt(low.value)}명 · 데이터 있는 날 기준` : undefined}
        />
        <StatTile
          label="주말 ÷ 평일"
          value={fmtRatio(k.weekendRatio)}
          sub={`일평균 주말 ${fmtInt(k.weekendMean)}명 · 평일 ${fmtInt(k.weekdayMean)}명`}
        />
        <StatTile
          label="일별 변동계수"
          value={fmtDecimal(cv)}
          sub="표준편차 ÷ 평균. 1을 넘으면 날마다 크게 들쭉날쭉합니다"
        />
      </section>

      <div className="grid">
        <Panel
          className="span-12"
          fig="01"
          title={unit === 'day' ? '일별 생활인구' : unit === 'week' ? '주별 일평균 생활인구' : '월별 일평균 생활인구'}
          subtitle={
            unit === 'day'
              ? '날짜별 합계와 최근 7일(데이터 있는 날) 평균입니다.'
              : `${unit === 'week' ? '월요일부터 한 주' : '한 달'}의 합계를 그 구간에서 데이터가 있는 날 수로 나눴습니다. 데이터가 일부만 있는 구간도 공정하게 비교할 수 있습니다.`
          }
          tools={<Segmented options={UNITS} value={unit} onChange={setUnit} label="묶는 단위" />}
          empty={empty}
          legend={
            unit === 'day' ? (
              <Legend
                items={[
                  { label: '일별 합계', color: 'var(--deemph)', kind: 'rect' },
                  { label: '7일 이동평균', color: 'var(--series-1)', kind: 'line' },
                  { label: '데이터 없음', color: 'var(--nodata)', kind: 'band' },
                ]}
              />
            ) : undefined
          }
          table={
            unit === 'day'
              ? {
                  columns: [{ label: '날짜' }, { label: '합계 (명)', numeric: true }, { label: '7일 이동평균 (명)', numeric: true }],
                  rows: daily.map((d) => [shortDay(d.day, true), d.hasData ? fmtInt(d.value) : '데이터 없음', fmtInt(d.ma7)]),
                }
              : {
                  columns: [{ label: '구간' }, { label: '데이터 있는 날', numeric: true }, { label: '합계 (명)', numeric: true }, { label: '일평균 (명)', numeric: true }],
                  rows: buckets.map((b) => [
                    `${dotDay(b.start)} – ${dotDay(b.end).slice(5)}`,
                    `${b.dataDays}/${b.periodDays}`,
                    fmtInt(b.sum),
                    b.dailyMean === null ? '데이터 없음' : fmtInt(b.dailyMean),
                  ]),
                }
          }
        >
          {unit === 'day' ? (
            <TrendChart points={daily} label={`일별 생활인구, ${condition.join(', ')}`} />
          ) : (
            <ColumnChart columns={bucketColumns} format={fmtInt} height={300} label={`${unit === 'week' ? '주' : '월'}별 일평균 생활인구`} />
          )}
        </Panel>

        <Panel
          className="span-7"
          fig="02"
          title="요일 × 월 일평균"
          subtitle="각 칸 = 그달 그 요일의 합계 ÷ 데이터 있는 날 수. 진할수록 많습니다."
          empty={empty}
          table={{
            columns: [{ label: '월' }, ...matrix.cols.map((c) => ({ label: c, numeric: true }))],
            rows: matrix.rows.map((r, i) => [r, ...matrix.cols.map((_, j) => fmtInt(matrix.cells[i * 7 + j].mean))]),
          }}
        >
          <Heatmap
            rows={matrix.rows}
            cols={matrix.cols}
            format={fmtInt}
            label="요일 × 월 일평균 생활인구"
            cells={matrix.cells.map((c) => ({
              row: c.row,
              col: c.col,
              value: c.mean,
              title: `${matrix.rows[c.row]} ${WEEKDAY_LABELS[c.col]}요일`,
              tooltip: [
                { label: '일평균 (명)', value: fmtInt(c.mean) },
                { label: '합계 (명)', value: fmtInt(c.sum) },
                { label: '데이터 있는 날', value: `${c.dataDays}일` },
              ],
            }))}
          />
        </Panel>

        <Panel
          className="span-5"
          fig="03"
          title="월별 일평균과 전월 대비"
          subtitle="데이터가 없는 달은 건너뛰고, 데이터가 있는 가장 가까운 앞 달과 비교합니다."
          empty={empty}
          table={{
            columns: [{ label: '월' }, { label: '일평균 (명)', numeric: true }, { label: '비교 대상' }, { label: '증감', numeric: true }],
            rows: changes.map((c) => [c.label, c.dailyMean === null ? '데이터 없음' : fmtInt(c.dailyMean), c.prevLabel ?? '—', signedPct(c.change)]),
          }}
        >
          <ColumnChart columns={monthColumns} format={fmtInt} height={250} label="월별 일평균 생활인구" />
          <ul className="change-list">
            {changes
              .filter((c) => c.change !== null)
              .map((c) => (
                <li key={c.key} data-sign={c.change! >= 0 ? 'up' : 'down'}>
                  <span>{c.label}</span>
                  <strong>{signedPct(c.change)}</strong>
                  <span className="muted">{c.prevLabel} 대비</span>
                </li>
              ))}
          </ul>
        </Panel>

        <Panel
          className="span-7"
          fig="04"
          title="주말 · 평일 일평균 (월별)"
          subtitle="달마다 주말(토·일)과 평일의 하루 평균을 나란히 놓았습니다."
          empty={empty}
          legend={
            <Legend
              items={[
                { label: '주말', color: 'var(--series-1)', kind: 'rect' },
                { label: '평일', color: 'var(--deemph)', kind: 'rect' },
              ]}
            />
          }
          table={{
            columns: [{ label: '월' }, { label: '주말 일평균 (명)', numeric: true }, { label: '평일 일평균 (명)', numeric: true }, { label: '주말 ÷ 평일', numeric: true }],
            rows: split.map((w) => [w.label, fmtInt(w.weekendMean), fmtInt(w.weekdayMean), fmtRatio(w.ratio)]),
          }}
        >
          <GroupedColumns
            series={[
              { key: 'we', label: '주말', color: 'var(--series-1)' },
              { key: 'wd', label: '평일', color: 'var(--deemph)' },
            ]}
            groups={split.map((w) => ({
              key: w.key,
              label: w.label,
              values: [w.weekendMean, w.weekdayMean],
              title: w.label,
              tooltip: [
                { label: '주말 일평균', value: fmtInt(w.weekendMean), color: 'var(--series-1)', swatch: 'rect' },
                { label: '평일 일평균', value: fmtInt(w.weekdayMean), color: 'var(--deemph)', swatch: 'rect' },
                { label: '주말 ÷ 평일', value: fmtRatio(w.ratio) },
              ],
            }))}
            format={fmtInt}
            height={280}
            label="월별 주말·평일 일평균"
          />
        </Panel>

        <Panel
          className="span-5"
          fig="05"
          title={`생활인구가 많은 날 TOP ${TOP_DAYS}`}
          subtitle="주말은 파랑, 평일은 회색. 원본 행 수가 많은 날일수록 합계도 커지는 경향이 있어 툴팁에 함께 적었습니다."
          empty={empty}
          table={{
            columns: [{ label: '순위', numeric: true }, { label: '날짜' }, { label: '생활인구 (명)', numeric: true }, { label: '원본 행 수', numeric: true }],
            rows: days.map((d, i) => [fmtInt(i + 1), shortDay(d.day, true), fmtInt(d.value), fmtInt(d.rows)]),
          }}
          foot={`데이터가 있는 ${fmtInt(days.length)}일 중 상위 ${TOP_DAYS}일. 표 보기에서 모든 날의 순위를 볼 수 있습니다.`}
        >
          <BarList items={dayItems} label={`생활인구가 많은 날 TOP ${TOP_DAYS}`} />
        </Panel>
      </div>
    </div>
  );
}
