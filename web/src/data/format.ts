const intFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });

export const DASH = '—';

/** 1690156.93 → 1,690,157 */
export function fmtInt(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? DASH : intFormat.format(v);
}

/** 0.2794 → 27.9% */
export function fmtPct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? DASH : `${(v * 100).toFixed(digits)}%`;
}

/** 1.504 → ×1.50 */
export function fmtRatio(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined || !Number.isFinite(v) ? DASH : `×${v.toFixed(digits)}`;
}

/** 소수점 아래 0은 지운다: 3 → 3, 5932.84 → 5,932.84 */
export function fmtNum(v: number | null | undefined, maxDigits = 2): string {
  return v === null || v === undefined || !Number.isFinite(v)
    ? DASH
    : v.toLocaleString('ko-KR', { maximumFractionDigits: maxDigits });
}

export function fmtDecimal(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined || !Number.isFinite(v)
    ? DASH
    : v.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
