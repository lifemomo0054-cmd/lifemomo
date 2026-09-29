// 날짜는 모두 'YYYY-MM-DD' 문자열로 다룬다. 시간대 영향을 받지 않도록 UTC 기준으로만 계산한다.

export const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];

export function parseDay(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return formatDay(parseDay(day) + n * 86_400_000);
}

export function daysBetween(start: string, end: string): number {
  return Math.round((parseDay(end) - parseDay(start)) / 86_400_000);
}

export function dayRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = parseDay(start), last = parseDay(end); t <= last; t += 86_400_000) out.push(formatDay(t));
  return out;
}

/** 0 = 월요일 … 6 = 일요일 */
export function weekdayOf(day: string): number {
  return (new Date(parseDay(day)).getUTCDay() + 6) % 7;
}

export function lastDayOfMonth(year: number, month: number): string {
  return formatDay(Date.UTC(year, month, 0));
}

/** 2026-03-05 → 3.5 (목) */
export function shortDay(day: string, withWeekday = false): string {
  const [, m, d] = day.split('-').map(Number);
  return withWeekday ? `${m}.${d} (${WEEKDAY_LABELS[weekdayOf(day)]})` : `${m}.${d}`;
}

/** 2026-03-05 → 2026.03.05 */
export function dotDay(day: string): string {
  return day.replaceAll('-', '.');
}
