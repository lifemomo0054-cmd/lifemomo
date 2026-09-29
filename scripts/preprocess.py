"""원본 CSV → 분석용 행 단위 데이터 (data/processed/stay_population.csv / .parquet)

원본 파일은 읽기만 한다. 행을 지우거나 값을 고치지 않고, 원본 80,193행을 그대로 둔 채
분석에 필요한 컬럼(날짜 파생, 연령대 묶음, 성별 표시명, 품질 표시)만 덧붙인다.

거주지·체류지는 5자리 코드 문자열로만 두고, 지역 이름·권역은
data/reference/region_codes.csv 의 region_code 와 JOIN 해서 붙인다.

이 데이터는 합성데이터다. 공식통계가 아니다. (ANALYSIS.md 참고)

    python scripts/preprocess.py [--input 원본.csv] [--no-parquet]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import pandas as pd

from common import (
    AGE_GROUPS,
    CAP_VALUE,
    GENDER_LABELS,
    NOTICE,
    PROCESSED_MANIFEST,
    PROCESSED_STEM,
    RAW_COLUMNS,
    RAW_CSV,
    WEEKDAY_NAMES,
    parquet_available,
    rel,
    sha256,
    write_json,
    write_table,
)

CODE_PATTERN = re.compile(r'^\d{5}$')


def read_raw(path: Path) -> pd.DataFrame:
    """원본을 전부 문자열로 읽는다. 코드 앞자리 0이나 값 표기가 바뀌지 않게 하기 위해서다."""
    raw = pd.read_csv(path, encoding='utf-8-sig', dtype=str, keep_default_na=False)
    if list(raw.columns) != RAW_COLUMNS:
        raise ValueError(f'원본 컬럼이 예상과 다릅니다: {list(raw.columns)} (예상: {RAW_COLUMNS})')
    return raw


def check_raw(raw: pd.DataFrame) -> None:
    """예상 밖의 값이 있으면 조용히 NaN으로 만들지 않고 멈춘다."""
    problems = []
    for col in RAW_COLUMNS:
        blank = (raw[col].str.strip() == '').sum()
        if blank:
            problems.append(f'{col}: 빈 값 {blank}개')
    for col in ('체류지시군구코드', '거주지시군구코드'):
        bad = ~raw[col].str.match(CODE_PATTERN)
        if bad.any():
            problems.append(f'{col}: 5자리 숫자가 아닌 값 {sorted(raw.loc[bad, col].unique())[:5]}')
    bad_gender = set(raw['성별']) - set(GENDER_LABELS)
    if bad_gender:
        problems.append(f'성별: 모르는 값 {sorted(bad_gender)}')
    bad_age = set(raw['연령대']) - set(AGE_GROUPS)
    if bad_age:
        problems.append(f'연령대: 모르는 값 {sorted(bad_age)}')
    dates = pd.to_datetime(raw['기준일자'], format='%Y-%m-%d', errors='coerce')
    if dates.isna().any():
        problems.append(f'기준일자: 날짜가 아닌 값 {raw.loc[dates.isna(), "기준일자"].unique()[:5].tolist()}')
    population = pd.to_numeric(raw['체류인구수'], errors='coerce')
    if population.isna().any():
        problems.append(f'체류인구수: 숫자가 아닌 값 {raw.loc[population.isna(), "체류인구수"].unique()[:5].tolist()}')
    elif (population < 0).any():
        problems.append(f'체류인구수: 음수 {int((population < 0).sum())}개')
    if problems:
        raise ValueError('원본 데이터 확인 필요:\n  - ' + '\n  - '.join(problems))


def build(raw: pd.DataFrame) -> pd.DataFrame:
    date = pd.to_datetime(raw['기준일자'], format='%Y-%m-%d')
    weekday = date.dt.dayofweek  # 0 = 월요일
    age = raw['연령대']
    population = pd.to_numeric(raw['체류인구수']).astype('float64')

    return pd.DataFrame({
        'source_row': range(1, len(raw) + 1),  # 원본 CSV의 데이터 행 번호 (헤더 제외, 1부터)
        'date': date,
        'year': date.dt.year.astype('int64'),
        'month': date.dt.month.astype('int64'),
        'day': date.dt.day.astype('int64'),
        'weekday': weekday.astype('int64'),
        'weekday_name': weekday.map(dict(enumerate(WEEKDAY_NAMES))),
        'is_weekend': weekday >= 5,
        'stay_region_code': raw['체류지시군구코드'],
        'origin_region_code': raw['거주지시군구코드'],
        'is_same_region': raw['거주지시군구코드'] == raw['체류지시군구코드'],
        'gender_code': raw['성별'],
        'gender_label': raw['성별'].map(GENDER_LABELS),
        'age_group_original': age,
        'age_group_10yr': age.map({k: v[0] for k, v in AGE_GROUPS.items()}),
        'life_stage': age.map({k: v[1] for k, v in AGE_GROUPS.items()}),
        'population': population,
        'is_zero': population == 0,
        'is_capped': (population - CAP_VALUE).abs() < 1e-9,
    })


def main() -> int:
    parser = argparse.ArgumentParser(description='김천시 체류인구 합성데이터 전처리')
    parser.add_argument('--input', type=Path, default=RAW_CSV, help='원본 CSV 경로')
    parser.add_argument('--no-parquet', action='store_true', help='Parquet 파일을 만들지 않는다')
    args = parser.parse_args()

    if not args.input.exists():
        print(f'원본 CSV가 없습니다: {args.input}', file=sys.stderr)
        return 1
    parquet = not args.no_parquet and parquet_available()
    if not args.no_parquet and not parquet:
        print('pyarrow가 없어 Parquet은 건너뜁니다. (pip install -r requirements.txt)')

    source_hash = sha256(args.input)
    raw = read_raw(args.input)
    check_raw(raw)
    df = build(raw)
    if sha256(args.input) != source_hash:  # 읽는 동안에도 원본이 그대로인지
        raise RuntimeError('처리 중에 원본 파일이 바뀌었습니다.')

    files = write_table(df, PROCESSED_STEM, parquet)
    dates = df['date'].dt.strftime('%Y-%m-%d')
    calendar = pd.date_range(df['date'].min(), df['date'].max()).strftime('%Y-%m-%d')
    write_json(PROCESSED_MANIFEST, {
        'notice': NOTICE,
        'source': {
            'file': rel(args.input),
            'sha256': source_hash,
            'bytes': args.input.stat().st_size,
            'rows': len(raw),
        },
        'output': {
            'files': files,
            'rows': len(df),
            'columns': list(df.columns),
        },
        'summary': {
            'date_min': dates.min(),
            'date_max': dates.max(),
            'dates_with_data': int(dates.nunique()),
            'dates_without_data': sorted(set(calendar) - set(dates)),
            'population_sum': round(float(df['population'].sum()), 2),
            'zero_rows': int(df['is_zero'].sum()),
            'capped_rows': int(df['is_capped'].sum()),
            'same_region_rows': int(df['is_same_region'].sum()),
        },
    })

    print(f'원본 {rel(args.input)} ({len(raw):,}행, sha256 {source_hash[:12]}…) — 수정하지 않음')
    for f in files + [rel(PROCESSED_MANIFEST)]:
        print(f'  → {f}')
    print(f'※ {NOTICE}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
