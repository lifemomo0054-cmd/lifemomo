// 필요한 몇 개만 직접 그린 선 아이콘 (1.5px, 16px 격자)

const PATHS = {
  menu: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11',
  close: 'M4 4l8 8M12 4l-8 8',
  chevron: 'M4.5 6.5L8 10l3.5-3.5',
  check: 'M3.5 8.5l3 3 6-7',
  search: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.6 10.6L14 14',
  sun: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1',
  moon: 'M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z',
  reset: 'M3 8a5 5 0 1 0 1.6-3.7M3 2.5v2.8h2.8',
  info: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 7.2V11M8 5v.01',
  filter: 'M2.5 3.5h11M4.5 8h7M6.5 12.5h3',
  download: 'M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** 브랜드 표시: 격자 위의 한 점 (한 지역에 모이는 사람들) */
export function BrandMark({ size = 28 }: { size?: number }) {
  const dots = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) dots.push([7 + x * 7, 7 + y * 7]);
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false" className="brand-mark">
      <rect x="0.75" y="0.75" width="26.5" height="26.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {dots.map(([cx, cy], i) =>
        i === 4 ? (
          <circle key={i} cx={cx} cy={cy} r="3" className="brand-mark-accent" />
        ) : (
          <circle key={i} cx={cx} cy={cy} r="1.25" fill="currentColor" />
        ),
      )}
    </svg>
  );
}
