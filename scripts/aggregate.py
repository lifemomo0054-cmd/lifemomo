"""분석용 행 단위 데이터 → 집계표 (data/processed/aggregates/*.csv / .parquet)

preprocess.py 를 먼저 실행해야 한다.

기본 규칙 (ANALYSIS.md 14-1의 선택지를 이렇게 정했다)
- 행은 하나도 빼지 않는다. 김천시 자체(거주지 47150) 행과 상한값(5,932.84) 행도 합계에 들어간다.
  대신 김천시 자체를 뺀 합계(external_population_sum)와 상한값 행 수(capped_rows)를 함께 둔다.
- 원본에 없는 조합은 0으로 채우지 않는다. 행이 있는 조합만 집계한다.
- 날짜가 빠진 구간(5월)은 daily·monthly 에 has_data = False 인 빈 행으로 남기고 보간하지 않는다.
- 거주지는 코드 그대로 집계한다(화성시 41590과 일반구 코드도 따로). 지역 이름·권역은
  data/reference/region_codes.csv 에서 JOIN 해 붙이며, 시 단위로 합칠 때는 city_code 를 쓴다.

이 데이터는 합성데이터다. 공식통계가 아니다. (ANALYSIS.md 참고)

    python scripts/aggregate.py [--no-parquet]
"""

from __future__ import annotations

import argparse
import sys

import pandas as pd

from common import (
    AGE_10YR_ORDER,
    AGE_GROUPS,
    AGE_ORDER,
    AGGREGATES_DIR,
    AGGREGATES_MANIFEST,
    GENDER_ORDER,
    LIFE_STAGE_ORDER,
    LIFE_STAGES,
    NOTICE,
    PROCESSED_MANIFEST,
    PROCESSED_STEM,
    WEEKDAY_NAMES,
    parquet_available,
    read_json,
    read_region_codes,
    read_table,
    rel,
    write_json,
    write_table,
)

METRICS = [
    'row_count',                # 집계에 들어간 원본 행 수
    'nonzero_rows',             # 그중 체류인구수가 0보다 큰 행 수
    'zero_ratio',               # 0인 행 비율
    'population_sum',           # 체류인구수 합계 (날짜를 더한 "연인원" 성격)
    'population_mean',          # 행당 평균
    'population_median',        # 행당 중앙값 (0이 77%라 대부분 0)
    'nonzero_median',           # 0을 뺀 중앙값
    'external_population_sum',  # 김천시 자체(거주지 = 체류지) 행을 뺀 합계
    'capped_rows',              # 상한값(5,932.84) 행 수
    'share_of_total',           # 전체 합계 대비 비중
]
ROUND = {
    'population_sum': 2, 'external_population_sum': 2,
    'population_mean': 4, 'population_median': 4, 'nonzero_median': 4, 'daily_mean': 4,
    'zero_ratio': 6, 'share_of_total': 6, 'share_within_group': 6,
}
ORDERS = {
    'age_group_original': AGE_ORDER,
    'age_group_10yr': AGE_10YR_ORDER,
    'life_stage': LIFE_STAGE_ORDER,
    'gender_code': GENDER_ORDER,
}
TABLES = {
    'daily': '날짜별 (달력상 모든 날짜, 데이터 없는 날은 has_data = False)',
    'monthly': '월별 (데이터 없는 달 포함, daily_mean = 합계 ÷ 데이터 있는 날 수)',
    'weekday': '요일별 (daily_mean = 합계 ÷ 그 요일의 데이터 있는 날 수)',
    'gender': '성별',
    'age': '원본 연령대(16구간)별',
    'life_stage': '생애단계(아동청소년·청년·중장년·고령)별',
    'origin_region': '거주지 시군구 코드별',
    'origin_region_age': '거주지 × 원본 연령대 (share_within_group = 거주지 안에서의 비중)',
    'origin_region_gender': '거주지 × 성별 (share_within_group = 거주지 안에서의 비중)',
    'date_age': '날짜 × 원본 연령대 (데이터 있는 날만, share_within_group = 그날 안에서의 비중)',
    'date_gender': '날짜 × 성별 (데이터 있는 날만, share_within_group = 그날 안에서의 비중)',
}


def summarize(df: pd.DataFrame, keys: list[str], total: float) -> pd.DataFrame:
    work = df.assign(
        _nonzero=(~df['is_zero']).astype('int64'),
        _capped=df['is_capped'].astype('int64'),
        _external=df['population'].where(~df['is_same_region'], 0.0),
        _positive=df['population'].where(~df['is_zero']),
    )
    out = work.groupby(keys, sort=False).agg(
        row_count=('population', 'size'),
        nonzero_rows=('_nonzero', 'sum'),
        population_sum=('population', 'sum'),
        population_mean=('population', 'mean'),
        population_median=('population', 'median'),
        nonzero_median=('_positive', 'median'),
        external_population_sum=('_external', 'sum'),
        capped_rows=('_capped', 'sum'),
    ).reset_index()
    out['zero_ratio'] = 1 - out['nonzero_rows'] / out['row_count']
    out['share_of_total'] = out['population_sum'] / total
    columns = keys + METRICS
    if len(keys) > 1:  # 첫 번째 키(거주지·날짜) 안에서의 비중
        group_sum = out.groupby(keys[0])['population_sum'].transform('sum')
        out['share_within_group'] = (out['population_sum'] / group_sum).where(group_sum > 0)
        columns.append('share_within_group')
    return sort_by(out[columns], keys)


def sort_by(df: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    sort_keys = {k: df[k].map({v: i for i, v in enumerate(ORDERS[k])}) if k in ORDERS else df[k] for k in keys}
    order = pd.DataFrame(sort_keys).sort_values(keys, kind='stable').index
    return df.loc[order].reset_index(drop=True)


def attach(df: pd.DataFrame, after: str, attrs: pd.DataFrame) -> pd.DataFrame:
    """after 컬럼 바로 뒤에 설명용 컬럼(이름·묶음)을 붙인다. attrs 의 첫 컬럼이 JOIN 키."""
    key = attrs.columns[0]
    merged = df.merge(attrs, on=key, how='left', validate='many_to_one')
    extra = [c for c in attrs.columns if c != key and c not in df.columns]
    cols = list(df.columns)
    pos = cols.index(after) + 1
    return merged[cols[:pos] + extra + cols[pos:]]


def age_attrs() -> pd.DataFrame:
    return pd.DataFrame(
        [(k, v[0], v[1], v[2]) for k, v in AGE_GROUPS.items()],
        columns=['age_group_original', 'age_group_10yr', 'life_stage', 'age_band_years'],
    ).astype({'age_band_years': 'Int64'})


def gender_attrs(df: pd.DataFrame) -> pd.DataFrame:
    return df[['gender_code', 'gender_label']].drop_duplicates()


def date_attrs(dates: pd.Series) -> pd.DataFrame:
    dates = pd.Series(pd.to_datetime(dates)).reset_index(drop=True)
    weekday = dates.dt.dayofweek
    return pd.DataFrame({
        'date': dates,
        'year': dates.dt.year.astype('int64'),
        'month': dates.dt.month.astype('int64'),
        'day': dates.dt.day.astype('int64'),
        'weekday': weekday.astype('int64'),
        'weekday_name': weekday.map(dict(enumerate(WEEKDAY_NAMES))),
        'is_weekend': weekday >= 5,
    })


def region_attrs(regions: pd.DataFrame) -> pd.DataFrame:
    return regions[['region_code', 'sido_name', 'sigungu_name', 'origin_zone']].rename(
        columns={'region_code': 'origin_region_code'})


def fill_missing(df: pd.DataFrame) -> pd.DataFrame:
    """데이터가 없는 날짜·달: 개수는 0, 값은 비워 둔다(0으로 채우거나 보간하지 않음)."""
    df['has_data'] = df['row_count'].notna()
    for col in ('row_count', 'nonzero_rows', 'capped_rows'):
        df[col] = df[col].fillna(0).astype('int64')
    return df


def daily(df: pd.DataFrame, total: float) -> pd.DataFrame:
    calendar = date_attrs(pd.date_range(df['date'].min(), df['date'].max()))
    out = calendar.merge(summarize(df, ['date'], total), on='date', how='left')
    out = fill_missing(out)
    return out[list(calendar.columns) + ['has_data'] + METRICS]


def monthly(df: pd.DataFrame, total: float) -> pd.DataFrame:
    months = pd.period_range(df['date'].min(), df['date'].max(), freq='M')
    calendar = pd.DataFrame({
        'year': months.year.astype('int64'),
        'month': months.month.astype('int64'),
        'year_month': months.strftime('%Y-%m'),
        'calendar_days': months.days_in_month.astype('int64'),
    })
    stats = summarize(df, ['year', 'month'], total)
    days = df.groupby(['year', 'month'])['date'].nunique().rename('days_with_data').reset_index()
    out = calendar.merge(days, on=['year', 'month'], how='left').merge(stats, on=['year', 'month'], how='left')
    out['days_with_data'] = out['days_with_data'].fillna(0).astype('int64')
    out = fill_missing(out)
    out['daily_mean'] = out['population_sum'] / out['days_with_data'].where(out['days_with_data'] > 0)
    return out[list(calendar.columns) + ['days_with_data', 'has_data'] + METRICS + ['daily_mean']]


def weekday(df: pd.DataFrame, total: float) -> pd.DataFrame:
    out = summarize(df, ['weekday'], total)
    days = df.groupby('weekday')['date'].nunique().rename('days_with_data').reset_index()
    out = out.merge(days, on='weekday')
    out.insert(1, 'weekday_name', out['weekday'].map(dict(enumerate(WEEKDAY_NAMES))))
    out.insert(2, 'is_weekend', out['weekday'] >= 5)
    out.insert(3, 'days_with_data', out.pop('days_with_data'))
    out['daily_mean'] = out['population_sum'] / out['days_with_data']
    return out


def build_all(df: pd.DataFrame, regions: pd.DataFrame) -> dict[str, pd.DataFrame]:
    total = float(df['population'].sum())
    ages, genders, places = age_attrs(), gender_attrs(df), region_attrs(regions)

    origin = attach(summarize(df, ['origin_region_code'], total), 'origin_region_code', places)
    origin.insert(4, 'population_rank', origin['population_sum'].rank(ascending=False, method='min').astype('int64'))

    life = summarize(df, ['life_stage'], total)
    life.insert(1, 'age_range', life['life_stage'].map(LIFE_STAGES))

    date_age = attach(summarize(df, ['date', 'age_group_original'], total), 'age_group_original',
                      ages[['age_group_original', 'age_group_10yr', 'life_stage']])
    date_gender = attach(summarize(df, ['date', 'gender_code'], total), 'gender_code', genders)
    origin_age = attach(summarize(df, ['origin_region_code', 'age_group_original'], total), 'origin_region_code', places)
    origin_age = attach(origin_age, 'age_group_original', ages[['age_group_original', 'age_group_10yr', 'life_stage']])
    origin_gender = attach(summarize(df, ['origin_region_code', 'gender_code'], total), 'origin_region_code', places)
    origin_gender = attach(origin_gender, 'gender_code', genders)

    tables = {
        'daily': daily(df, total),
        'monthly': monthly(df, total),
        'weekday': weekday(df, total),
        'gender': attach(summarize(df, ['gender_code'], total), 'gender_code', genders),
        'age': attach(summarize(df, ['age_group_original'], total), 'age_group_original', ages),
        'life_stage': life,
        'origin_region': origin,
        'origin_region_age': origin_age,
        'origin_region_gender': origin_gender,
        'date_age': date_age,
        'date_gender': date_gender,
    }
    for table in tables.values():
        for col, digits in ROUND.items():
            if col in table.columns:
                table[col] = table[col].astype('float64').round(digits)
    return tables


def main() -> int:
    parser = argparse.ArgumentParser(description='김천시 체류인구 합성데이터 집계')
    parser.add_argument('--no-parquet', action='store_true', help='Parquet 파일을 만들지 않는다')
    args = parser.parse_args()

    if not PROCESSED_MANIFEST.exists():
        print('전처리 결과가 없습니다. 먼저 python scripts/preprocess.py 를 실행하세요.', file=sys.stderr)
        return 1
    parquet = not args.no_parquet and parquet_available()
    if not args.no_parquet and not parquet:
        print('pyarrow가 없어 Parquet은 건너뜁니다. (pip install -r requirements.txt)')

    source = read_json(PROCESSED_MANIFEST)['source']
    df = read_table(PROCESSED_STEM)
    regions = read_region_codes()
    unknown = sorted(set(df['origin_region_code']) - set(regions['region_code']))
    if unknown:
        print(f'region_codes.csv 에 없는 거주지 코드가 있습니다: {unknown}', file=sys.stderr)
        return 1

    tables = build_all(df, regions)
    manifest = {'notice': NOTICE, 'source': source, 'tables': {}}
    for name, table in tables.items():
        files = write_table(table, AGGREGATES_DIR / name, parquet)
        manifest['tables'][name] = {'description': TABLES[name], 'rows': len(table), 'files': files}
        print(f'  → {name:<22} {len(table):>6,}행  {", ".join(files)}')
    write_json(AGGREGATES_MANIFEST, manifest)
    print(f'  → {rel(AGGREGATES_MANIFEST)}')
    print(f'※ {NOTICE}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
