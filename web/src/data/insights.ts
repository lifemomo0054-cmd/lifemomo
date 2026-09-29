// 규칙 기반 자동 요약. AI(언어 모델)를 쓰지 않고, 정해진 계산 규칙으로 눈에 띄는 점을 문장으로 만든다.

import { shortDay } from './dates';
import { sexRatios } from './demographics';
import { kpis, rankRegions, type Summary } from './engine';
import { ageLabel, describeAges, describePeriod, describeRegion } from './filters';
import { fmtInt, fmtNum, fmtPct, fmtRatio, josa } from './format';
import { dailyVariation, monthChanges, periodSeries, rankDays } from './time';
import type { Dataset } from './types';

export type FindingKind = '규모' | '시간' | '인구 구조' | '유입지역' | '데이터 주의';

export interface Finding {
  id: string;
  kind: FindingKind;
  title: string;
  text: string;
  metric: { label: string; value: string };
  link?: { path: string; label: string };
  caution?: boolean; // 해석할 때 주의가 필요한 사항
}

export function findings(ds: Dataset, s: Summary): Finding[] {
  if (s.rowCount === 0 || s.total <= 0) return [];
  const k = kpis(ds, s);
  const out: Finding[] = [];

  out.push({
    id: 'scale',
    kind: '규모',
    title: '하루 평균 규모',
    text: `선택한 조건에서 하루 평균 ${fmtInt(k.dailyMean)}명이 머뭅니다. 데이터가 있는 ${fmtInt(s.dataDays)}일의 합계는 ${fmtInt(s.total)}명(연인원)입니다.`,
    metric: { label: '일평균', value: `${fmtInt(k.dailyMean)}명` },
  });

  if (k.weekendRatio !== null) {
    const r = k.weekendRatio;
    const text =
      r >= 1.1
        ? `주말 하루 평균(${fmtInt(k.weekendMean)}명)이 평일(${fmtInt(k.weekdayMean)}명)의 ${fmtRatio(r)}입니다. 주말에 더 많이 머뭅니다.`
        : r <= 0.9
          ? `평일 하루 평균(${fmtInt(k.weekdayMean)}명)이 주말(${fmtInt(k.weekendMean)}명)보다 많습니다(주말 ÷ 평일 ${fmtRatio(r)}).`
          : `주말과 평일의 하루 평균이 비슷합니다(주말 ÷ 평일 ${fmtRatio(r)}).`;
    out.push({ id: 'weekend', kind: '시간', title: '주말 효과', text, metric: { label: '주말 ÷ 평일', value: fmtRatio(r) }, link: { path: '/time', label: '시간 분석' } });
  }

  const days = rankDays(ds, s);
  if (days.length > 0 && k.dailyMean) {
    const top = days[0];
    out.push({
      id: 'peak',
      kind: '시간',
      title: '가장 많은 날',
      text: `${josa(shortDay(top.day, true), '이', '가')} ${fmtInt(top.value)}명으로 가장 많습니다. 일평균의 ${fmtNum(top.value / k.dailyMean, 1)}배이며, 그날 원본 행은 ${fmtInt(top.rows)}개입니다.`,
      metric: { label: shortDay(top.day, true), value: `${fmtInt(top.value)}명` },
      link: { path: '/time', label: '시간 분석' },
    });
  }

  const changes = monthChanges(periodSeries(ds, s, 'month')).filter((c) => c.change !== null);
  if (changes.length > 0) {
    const big = changes.reduce((a, b) => (Math.abs(b.change!) > Math.abs(a.change!) ? b : a));
    const months = periodSeries(ds, s, 'month');
    const from = months.findIndex((m) => m.label === big.prevLabel);
    const to = months.findIndex((m) => m.key === big.key);
    const skipped = months.slice(from + 1, to).map((m) => m.label);
    out.push({
      id: 'month',
      kind: '시간',
      title: '가장 큰 월 변화',
      text: `${big.label} 일평균이 ${big.prevLabel}보다 ${fmtPct(Math.abs(big.change!))} ${big.change! >= 0 ? '늘었습니다' : '줄었습니다'}.${
        skipped.length ? ` 사이의 ${skipped.join('·')}은 데이터가 없어 ${big.prevLabel}과 비교했습니다.` : ''
      }`,
      metric: { label: `${big.label} (${big.prevLabel} 대비)`, value: `${big.change! >= 0 ? '+' : '−'}${fmtPct(Math.abs(big.change!))}` },
      link: { path: '/time', label: '시간 분석' },
    });
  }

  const cv = dailyVariation(ds, s);
  if (cv !== null && cv >= 1) {
    out.push({
      id: 'volatility',
      kind: '데이터 주의',
      title: '날마다 크게 들쭉날쭉함',
      text: `일별 합계의 변동계수가 ${fmtNum(cv, 2)}로 큽니다. 날짜마다 기록된 원본 행 수가 달라서일 수 있으니, 하루 값보다 주·월 평균으로 읽는 편이 안전합니다.`,
      metric: { label: '변동계수', value: fmtNum(cv, 2) },
      link: { path: '/time', label: '시간 분석' },
      caution: true,
    });
  }

  if (k.topAge10) {
    out.push({
      id: 'age',
      kind: '인구 구조',
      title: '가장 많은 연령대',
      text: `${josa(k.topAge10.label, '이', '가')} ${fmtInt(k.topAge10.value)}명으로 전체의 ${fmtPct(k.topAge10.share)}를 차지합니다.${k.topLifeStage ? ` 생애단계로는 ${k.topLifeStage.label}(${k.topLifeStage.note})이 ${fmtPct(k.topLifeStage.share)}로 가장 큽니다.` : ''}`,
      metric: { label: '주요 연령대', value: k.topAge10.label },
      link: { path: '/demographics', label: '연령·성별' },
    });
  }

  const ratios = sexRatios(ds, s);
  if (ratios.overall.ratio !== null && s.filters.gender === 'all') {
    const skew = ratios.byAge.filter((r) => r.ratio !== null).reduce((a, b) => (Math.abs(Math.log(b.ratio!)) > Math.abs(Math.log(a.ratio!)) ? b : a), ratios.byAge[0]);
    const m = ds.genders.find((g) => g.code === 'male')!.label;
    const f = ds.genders.find((g) => g.code === 'female')!.label;
    out.push({
      id: 'sex',
      kind: '인구 구조',
      title: '성비',
      text: `${f} 100명당 ${josa(m, '이', '가')} ${fmtNum(ratios.overall.ratio, 1)}명입니다.${skew?.ratio ? ` 가장 치우친 연령대는 ${skew.label}(${fmtNum(skew.ratio, 1)})입니다.` : ''}`,
      metric: { label: '성비', value: fmtNum(ratios.overall.ratio, 1) },
      link: { path: '/demographics', label: '연령·성별' },
    });
  }

  const ranked = rankRegions(ds, s).filter((r) => !r.isStay && r.value > 0);
  const external = ranked.reduce((n, r) => n + r.value, 0);
  if (ranked.length >= 3 && external > 0) {
    const top3 = ranked.slice(0, 3);
    const share = top3.reduce((n, r) => n + r.value, 0) / external;
    out.push({
      id: 'origins',
      kind: '유입지역',
      title: '유입이 몰린 곳',
      text: `외부 유입의 ${fmtPct(share)}가 ${top3.map((r) => `${r.sidoShort} ${r.name}`).join(', ')} 세 곳에서 옵니다. 1위 ${top3[0].sidoShort} ${top3[0].name}만 ${fmtPct(top3[0].value / external)}입니다.`,
      metric: { label: '상위 3곳 비중', value: fmtPct(share) },
      link: { path: '/origins', label: '유입지역' },
    });
  }

  const adjacent = ds.regions.reduce((n, r, i) => n + (r.adjacent ? s.byRegion[i] : 0), 0);
  if (external > 0 && adjacent > 0) {
    out.push({
      id: 'adjacent',
      kind: '유입지역',
      title: '이웃 시군의 몫',
      text: `${josa(ds.stayName, '과', '와')} 경계를 맞댄 ${ds.regions.filter((r) => r.adjacent).length}개 시군에서 외부 유입의 ${fmtPct(adjacent / external)}가 옵니다.`,
      metric: { label: '인접 시군 비중', value: fmtPct(adjacent / external) },
      link: { path: '/map', label: '생활인구 지도' },
    });
  }

  const gap = s.periodDays - s.dataDays;
  if (gap > 0) {
    out.push({
      id: 'gap',
      kind: '데이터 주의',
      title: '데이터가 없는 날',
      text: `선택 기간 ${fmtInt(s.periodDays)}일 중 ${fmtInt(gap)}일은 원본에 데이터가 없습니다. 0으로 채우지 않았고, 일평균은 데이터가 있는 날로만 나눴습니다.`,
      metric: { label: '빈 날', value: `${fmtInt(gap)}일` },
      caution: true,
    });
  }
  if ((k.cappedShare ?? 0) > 0.05) {
    out.push({
      id: 'cap',
      kind: '데이터 주의',
      title: '상한값이 합계를 좌우함',
      text: `생활인구가 ${fmtNum(ds.cap100 / 100)}로 같은 행 ${fmtInt(s.cappedRows)}개가 합계의 ${fmtPct(k.cappedShare)}입니다. 상한에서 잘라 낸 값으로 보여, 이 행들이 결과를 크게 움직일 수 있습니다.`,
      metric: { label: '상한값 비중', value: fmtPct(k.cappedShare) },
      link: { path: '/explore', label: '데이터 탐색기' },
      caution: true,
    });
  }
  if ((k.selfShare ?? 0) > 0) {
    out.push({
      id: 'self',
      kind: '데이터 주의',
      title: `${ds.stayName} 거주자 포함`,
      text: `거주지가 ${ds.stayName}인 행이 합계의 ${fmtPct(k.selfShare)}입니다. 공식 체류인구는 보통 그 지역 주민을 빼고 셉니다. 거주지역 필터의 ‘외부 유입만’으로 따로 볼 수 있습니다.`,
      metric: { label: '자체 비중', value: fmtPct(k.selfShare) },
      caution: true,
    });
  }
  return out;
}

/** 나중에 AI를 연결하면 질문과 함께 보낼 요약. 지금은 화면에 미리보기로만 보여 준다. */
export function aiContext(ds: Dataset, s: Summary, list: Finding[]): string {
  const gender = s.filters.gender === 'all' ? '전체' : ds.genders.find((g) => g.code === s.filters.gender)!.label;
  const lines = [
    `[데이터] ${ds.stayRegion.name} ${ds.measure} — 합성데이터, 공식통계 아님`,
    `[조건] 기간 ${describePeriod(ds, s.filters)} · 성별 ${gender} · 연령 ${describeAges(ds, s.filters.ages)} · 거주지역 ${describeRegion(ds, s.filters.region)}`,
    `[행] ${fmtInt(s.rowCount)}행 / 원본 ${fmtInt(ds.rows.n)}행 · 데이터 있는 날 ${fmtInt(s.dataDays)}일 / 기간 ${fmtInt(s.periodDays)}일`,
    `[원본 연령대] ${ds.ages.map((a) => ageLabel(a.code)).join(', ')}`,
    ...list.map((f) => `[${f.kind}] ${f.title}: ${f.text}`),
  ];
  return lines.join('\n');
}
