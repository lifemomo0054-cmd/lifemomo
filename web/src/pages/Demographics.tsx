import { useMemo } from 'react';
import { Heatmap } from '../components/charts/Heatmap';
import { Legend } from '../components/charts/Legend';
import { StackedColumns } from '../components/charts/MultiColumns';
import { Pyramid, RatioBars } from '../components/charts/Pyramid';
import { SegmentBar, StackedBar } from '../components/charts/StackedBar';
import { StatTile } from '../components/ui/Metrics';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { ageByZone, lifeStagesByMonth, medianAgeBand, pyramid, sexRatios } from '../data/demographics';
import { kpis, lifeStageShares } from '../data/engine';
import { ageLabel } from '../data/filters';
import { DASH, fmtDecimal, fmtInt, fmtPct } from '../data/format';
import { useDataset } from '../state/DataProvider';
import { useFilters } from '../state/FilterProvider';

const SEX_COLORS: Record<string, string> = { male: 'var(--series-1)', female: 'var(--series-2)' };
const STAGE_COLORS = ['var(--ord-1)', 'var(--ord-2)', 'var(--ord-3)', 'var(--ord-4)'];

export function Demographics() {
  const ds = useDataset();
  const { summary: s, filters } = useFilters();

  const v = useMemo(
    () => ({
      k: kpis(ds, s),
      pyramid: pyramid(ds, s),
      ratios: sexRatios(ds, s),
      stageMonths: lifeStagesByMonth(ds, s),
      stages: lifeStageShares(ds, s),
      zoneAge: ageByZone(ds, s),
      median: medianAgeBand(ds, s),
    }),
    [ds, s],
  );
  const { k, ratios, stageMonths, stages, zoneAge, median } = v;
  const empty = s.rowCount === 0 || s.total === 0;
  const mi = ds.genders.findIndex((g) => g.code === 'male');
  const fi = ds.genders.findIndex((g) => g.code === 'female');
  const male = ds.genders[mi];
  const female = ds.genders[fi];
  const ratioNote = filters.gender !== 'all' ? ' 성별 조건이 걸려 있어 성비를 계산할 수 없습니다.' : '';

  const zoneRows = zoneAge.rows.filter((r) => r.total > 0);

  // 생애단계별 남녀 구성 (연령대 × 성별 표에서 묶음)
  const stageSex = ds.lifeStages.map((l, st) => {
    const values = ds.genders.map((_, g) =>
      ds.ages.reduce((n, _a, a) => n + (ds.ageLifeStage[a] === st ? s.byAgeGender[a * ds.genders.length + g] : 0), 0),
    );
    const total = values.reduce((x, y) => x + y, 0);
    return {
      key: l.name,
      label: l.name,
      total,
      parts: ds.genders.map((gd, g) => ({ key: gd.code, label: gd.label, value: values[g], share: total > 0 ? values[g] / total : null })),
    };
  });

  return (
    <div className="page-demographics">
      <PageHeader
        no="03"
        en="Demographics"
        title="연령 · 성별"
        lead="누가 머무는지 봅니다. 성·연령 구조, 연령대별 성비, 달마다 달라지는 생애단계 구성, 권역마다 다른 연령 구성을 같은 조건으로 계산합니다."
      />

      <section className="kpi-row" aria-label="인구 구조 지표">
        <StatTile
          label="성비"
          value={ratios.overall.ratio === null ? DASH : fmtDecimal(ratios.overall.ratio, 1)}
          sub={`${female.label} 100명당 ${male.label} · ${male.label} ${fmtInt(ratios.overall.male)}명, ${female.label} ${fmtInt(ratios.overall.female)}명`}
        />
        <StatTile label="중위 연령대" value={median ? ageLabel(median) : DASH} sub="생활인구를 나이순으로 줄 세웠을 때 가운데가 속한 연령대" />
        <StatTile
          label="주요 연령대"
          value={k.topAge10?.label ?? DASH}
          sub={k.topAge10 ? `${fmtInt(k.topAge10.value)}명 · 전체의 ${fmtPct(k.topAge10.share)}` : undefined}
        />
        <StatTile
          label="가장 큰 생애단계"
          value={k.topLifeStage?.label ?? DASH}
          sub={k.topLifeStage ? `${k.topLifeStage.note} · 전체의 ${fmtPct(k.topLifeStage.share)}` : undefined}
        />
      </section>

      <div className="grid">
        <Panel
          className="span-7"
          fig="01"
          title="성 · 연령 피라미드"
          subtitle={`원본 연령대별 ${male.label}(왼쪽)과 ${female.label}(오른쪽). 위로 갈수록 나이가 많습니다.`}
          empty={empty}
          legend={
            <Legend
              items={[
                { label: male.label, color: SEX_COLORS.male, kind: 'rect' },
                { label: female.label, color: SEX_COLORS.female, kind: 'rect' },
              ]}
            />
          }
          table={{
            columns: [{ label: '연령대' }, { label: `${male.label} (명)`, numeric: true }, { label: `${female.label} (명)`, numeric: true }, { label: '합계 (명)', numeric: true }, { label: '비중', numeric: true }],
            rows: [...v.pyramid].reverse().map((r) => [r.label, fmtInt(r.values[mi]), fmtInt(r.values[fi]), fmtInt(r.total), fmtPct(s.total > 0 ? r.total / s.total : null)]),
          }}
        >
          <Pyramid
            rows={v.pyramid.map((r) => ({
              key: r.code,
              label: r.label,
              left: r.values[mi],
              right: r.values[fi],
              tooltip: [
                { label: male.label, value: `${fmtInt(r.values[mi])}명`, color: SEX_COLORS.male },
                { label: female.label, value: `${fmtInt(r.values[fi])}명`, color: SEX_COLORS.female },
                { label: '성비', value: r.values[fi] > 0 ? fmtDecimal((r.values[mi] / r.values[fi]) * 100, 1) : DASH },
              ],
            }))}
            leftLabel={male.label}
            rightLabel={female.label}
            leftColor={SEX_COLORS.male}
            rightColor={SEX_COLORS.female}
            total={s.total}
            label="성·연령 피라미드"
          />
        </Panel>

        <Panel
          className="span-5"
          fig="02"
          title="연령대별 성비"
          subtitle={`${female.label} 100명당 ${male.label}. 100보다 크면 ${male.label}이 많습니다(가운데 선이 100, 로그 눈금).${ratioNote}`}
          empty={empty}
          table={{
            columns: [{ label: '연령대' }, { label: `${male.label} (명)`, numeric: true }, { label: `${female.label} (명)`, numeric: true }, { label: '성비', numeric: true }],
            rows: [ratios.overall, ...ratios.byAge].map((r) => [r.label, fmtInt(r.male), fmtInt(r.female), r.ratio === null ? DASH : fmtDecimal(r.ratio, 1)]),
          }}
        >
          <RatioBars
            rows={[ratios.overall, ...ratios.byAge].map((r) => ({
              key: r.key,
              label: r.label,
              ratio: r.ratio,
              tooltip: [
                { label: '성비', value: r.ratio === null ? DASH : fmtDecimal(r.ratio, 1) },
                { label: `${male.label} (명)`, value: fmtInt(r.male) },
                { label: `${female.label} (명)`, value: fmtInt(r.female) },
              ],
            }))}
            leftColor={SEX_COLORS.female}
            rightColor={SEX_COLORS.male}
            leftNote={`${female.label}이 많음`}
            rightNote={`${male.label}이 많음`}
          />
        </Panel>

        <Panel
          className="span-7"
          fig="03"
          title="생애단계 구성 (월별)"
          subtitle="달마다 생애단계별 비중. 막대 하나가 그달 생활인구 전체(100%)입니다."
          empty={empty}
          legend={<Legend items={ds.lifeStages.map((l, i) => ({ label: `${l.name} ${l.range}`, color: STAGE_COLORS[i], kind: 'rect' as const }))} />}
          table={{
            columns: [{ label: '월' }, ...ds.lifeStages.map((l) => ({ label: l.name, numeric: true }))],
            rows: stageMonths.map((m) => [m.label, ...m.values.map((x) => (m.total > 0 ? fmtPct(x / m.total) : '데이터 없음'))]),
          }}
        >
          <StackedColumns
            series={ds.lifeStages.map((l, i) => ({ key: l.name, label: l.name, color: STAGE_COLORS[i] }))}
            groups={stageMonths.map((m) => ({
              key: m.key,
              label: m.label,
              values: m.values,
              title: `${m.label} · 데이터 ${m.dataDays}일`,
              tooltip: ds.lifeStages
                .map((l, i) => ({
                  label: l.name,
                  value: m.total > 0 ? `${fmtPct(m.values[i] / m.total)} · ${fmtInt(m.values[i])}명` : '데이터 없음',
                  color: STAGE_COLORS[i],
                  swatch: 'rect' as const,
                }))
                .reverse(),
            }))}
            height={300}
            label="월별 생애단계 구성"
          />
        </Panel>

        <Panel
          className="span-5"
          fig="04"
          title="생애단계 비중"
          subtitle="선택 기간 전체의 생애단계별 생활인구"
          empty={empty}
          table={{
            columns: [
              { label: '생애단계' },
              { label: '나이' },
              { label: '생활인구 (명)', numeric: true },
              { label: '비중', numeric: true },
              ...ds.genders.map((g) => ({ label: `${g.label} 비중`, numeric: true })),
            ],
            rows: stages.map((l, i) => [l.label, l.note ?? '', fmtInt(l.value), fmtPct(l.share), ...stageSex[i].parts.map((p) => fmtPct(p.share))]),
          }}
        >
          <StackedBar title="" parts={stages} colors={STAGE_COLORS} />
          <div className="split">
            <p className="stacked-title">생애단계별 {ds.genders.map((g) => g.label).join(' · ')}</p>
            <ul className="split-rows">
              {stageSex.map((st) => (
                <li key={st.key} className="split-row">
                  <span className="split-label">{st.label}</span>
                  <SegmentBar
                    parts={st.parts}
                    colors={ds.genders.map((g) => SEX_COLORS[g.code])}
                    height={10}
                    label={`${st.label} 성별 구성`}
                    tooltip={(p) => ({
                      title: `${st.label} · ${p.label}`,
                      rows: [
                        { label: '명', value: fmtInt(p.value) },
                        { label: `${st.label} 안 비중`, value: fmtPct(p.share) },
                      ],
                    })}
                  />
                  <span className="split-ratio">{st.total > 0 ? st.parts.map((p) => Math.round((p.share ?? 0) * 100)).join(' : ') : '—'}</span>
                </li>
              ))}
            </ul>
            <p className="split-note">오른쪽 숫자: {ds.genders.map((g) => g.label).join(' : ')} 비율(%)</p>
          </div>
        </Panel>

        <Panel
          className="span-12"
          fig="05"
          title="권역별 연령 구성"
          subtitle={`${ds.stayName} 기준 권역마다 10세 연령대 비중(가로 합 100%). 어느 권역에서 어떤 나이대가 오는지 비교합니다.`}
          empty={empty}
          table={{
            columns: [{ label: '권역' }, { label: '합계 (명)', numeric: true }, ...zoneAge.cols.map((c) => ({ label: c.label, numeric: true }))],
            rows: zoneRows.map((r) => [r.zone, fmtInt(r.total), ...r.values.map((x) => fmtPct(x / r.total))]),
          }}
        >
          <Heatmap
            rows={zoneRows.map((r) => r.zone)}
            cols={zoneAge.cols.map((c) => c.label)}
            rowHeader={112}
            format={(x) => fmtPct(x)}
            label="권역별 연령 구성"
            cells={zoneRows.flatMap((r, i) =>
              r.values.map((x, j) => ({
                row: i,
                col: j,
                value: x / r.total,
                title: `${r.zone} · ${zoneAge.cols[j].label}`,
                tooltip: [
                  { label: '권역 안 비중', value: fmtPct(x / r.total) },
                  { label: '명', value: fmtInt(x) },
                ],
              })),
            )}
          />
        </Panel>
      </div>
    </div>
  );
}
