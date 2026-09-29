import type { Age10Point, SharePoint } from '../../data/engine';
import { fmtInt, fmtPct } from '../../data/format';
import { SegmentBar, StackedBar } from './StackedBar';

/** 전체 성별 구성 + 연령대(10세)별 성별 구성. 모든 조각에 hover 툴팁. */
export function GenderComposition({ overall, byAge, colors }: { overall: SharePoint[]; byAge: Age10Point[]; colors: string[] }) {
  return (
    <div className="gender-comp">
      <StackedBar title="전체" parts={overall} colors={colors} />
      <div className="split">
        <p className="stacked-title">연령대별</p>
        <ul className="split-rows">
          {byAge.map((a) => (
            <li key={a.key} className="split-row">
              <span className="split-label">{a.label}</span>
              <SegmentBar
                parts={a.byGender}
                colors={colors}
                height={10}
                label={`${a.label} 성별 구성`}
                tooltip={(p) => ({
                  title: `${a.label} · ${p.label}`,
                  rows: [
                    { label: '명', value: fmtInt(p.value) },
                    { label: `${a.label} 안 비중`, value: fmtPct(p.share) },
                  ],
                })}
              />
              <span className="split-ratio">
                {a.value > 0 ? a.byGender.map((g) => Math.round((g.share ?? 0) * 100)).join(' : ') : '—'}
              </span>
            </li>
          ))}
        </ul>
        <p className="split-note">오른쪽 숫자: {overall.map((g) => g.label).join(' : ')} 비율(%)</p>
      </div>
    </div>
  );
}
