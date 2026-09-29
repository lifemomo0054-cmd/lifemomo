import { dayRange, lastDayOfMonth, weekdayOf } from './dates';
import type { Dataset, MonthInfo, RawDataset } from './types';

/** JSON을 계산하기 좋은 형태(정수 배열, 미리 만든 색인)로 바꾼다. */
export function decodeDataset(raw: RawDataset): Dataset {
  const { rows } = raw;
  for (const key of ['date', 'region', 'gender', 'age', 'pop100'] as const) {
    if (rows[key].length !== rows.n) throw new Error(`데이터 형식 오류: rows.${key} 길이가 ${rows.n}이 아닙니다.`);
  }

  const calendar = dayRange(raw.calendar.start, raw.calendar.end);
  const calendarIndex = new Map(calendar.map((d, i) => [d, i]));
  const calendarHasData = new Uint8Array(calendar.length);
  const dateCalendarIndex = new Int32Array(raw.dates.length);
  raw.dates.forEach((d, i) => {
    const c = calendarIndex.get(d);
    if (c === undefined) throw new Error(`데이터 형식 오류: ${d} 가 기간 밖입니다.`);
    dateCalendarIndex[i] = c;
    calendarHasData[c] = 1;
  });

  const months: MonthInfo[] = [];
  const monthIndex = new Map<string, number>();
  for (const day of calendar) {
    const key = day.slice(0, 7);
    if (monthIndex.has(key)) continue;
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(5, 7));
    monthIndex.set(key, months.length);
    months.push({ key, year, month, label: `${month}월`, firstDay: `${key}-01`, lastDay: lastDayOfMonth(year, month) });
  }

  const lifeStageIndex = new Map(raw.lifeStages.map((s, i) => [s.name, i]));
  const zoneIndex = new Map(raw.zones.map((z, i) => [z, i]));
  const regionIndex = new Map(raw.regions.map((r, i) => [r.code, i]));
  const stayRegionIndex = regionIndex.get(raw.stayRegion.code);
  if (stayRegionIndex === undefined) throw new Error('데이터 형식 오류: 체류지 코드가 지역 목록에 없습니다.');

  return {
    notice: raw.notice,
    source: raw.source,
    stayRegion: raw.stayRegion,
    stayRegionIndex,
    cap100: Math.round(raw.capValue * 100),
    calendar,
    calendarHasData,
    dates: raw.dates,
    dateCalendarIndex,
    dateWeekday: Uint8Array.from(raw.dates, weekdayOf),
    dateMonth: Uint8Array.from(raw.dates, (d) => monthIndex.get(d.slice(0, 7))!),
    months,
    genders: raw.genders,
    ages: raw.ages,
    ageLifeStage: Uint8Array.from(raw.ages, (a) => lifeStageIndex.get(a.lifeStage)!),
    lifeStages: raw.lifeStages,
    zones: raw.zones,
    sidos: raw.sidos,
    regions: raw.regions,
    regionZone: Uint8Array.from(raw.regions, (r) => zoneIndex.get(r.zone)!),
    regionIndex,
    rows: {
      n: rows.n,
      date: Uint16Array.from(rows.date),
      region: Uint16Array.from(rows.region),
      gender: Uint8Array.from(rows.gender),
      age: Uint8Array.from(rows.age),
      pop100: Int32Array.from(rows.pop100),
    },
  };
}

export async function loadDataset(url: string, signal?: AbortSignal): Promise<Dataset> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`데이터를 불러오지 못했습니다 (${res.status}).`);
  return decodeDataset((await res.json()) as RawDataset);
}
