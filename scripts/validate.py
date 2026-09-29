"""원본·전처리 결과·집계표를 서로 대조해 검증한다.

전처리·집계 코드의 매핑 표를 다시 쓰지 않고, 원본 문자열에서 직접 다시 계산해 비교한다.
실패가 하나라도 있으면 종료 코드 1로 끝난다.

    python scripts/validate.py
"""

from __future__ import annotations

import datetime as dt
import json
import sys

import numpy as np
import pandas as pd

from common import (
    AGGREGATES_DIR,
    AGGREGATES_MANIFEST,
    NOTICE,
    PROCESSED_MANIFEST,
    PROCESSED_STEM,
    RAW_COLUMNS,
    RAW_CSV,
    ROOT,
    parquet_available,
    read_json,
    read_region_codes,
    read_table,
    rel,
    sha256,
)

# ANALYSIS.md 0절에 적어 둔 원본 파일의 SHA-256. 원본이 한 바이트라도 바뀌면 여기서 걸린다.
ANALYSIS_SHA256 = '81f50c6323d2223319b051ef26e47f53feca6233e85aa3489f8193da09514416'
CAP_VALUE = 5932.84

PROCESSED_COLUMNS = [
    'source_row', 'date', 'year', 'month', 'day', 'weekday', 'weekday_name', 'is_weekend',
    'stay_region_code', 'origin_region_code', 'is_same_region',
    'gender_code', 'gender_label', 'age_group_original', 'age_group_10yr', 'life_stage',
    'population', 'is_zero', 'is_capped',
]
# 집계표 이름 → 원본에서 다시 계산할 때 쓰는 키
AGGREGATE_KEYS = {
    'daily': ['date'],
    'monthly': ['year', 'month'],
    'weekday': ['weekday'],
    'gender': ['gender_code'],
    'age': ['age_group_original'],
    'life_stage': ['life_stage'],
    'origin_region': ['origin_region_code'],
    'origin_region_age': ['origin_region_code', 'age_group_original'],
    'origin_region_gender': ['origin_region_code', 'gender_code'],
    'date_age': ['date', 'age_group_original'],
    'date_gender': ['date', 'gender_code'],
}
SUM_TOL = 0.01
WEB_DATA = ROOT / 'web' / 'public' / 'data' / 'population.json'


# ── 원본에서 독립적으로 다시 계산하는 규칙 ─────────────────────────────────────────

def lower_age(group: str) -> int:
    return int(group.rstrip('+').split('-')[0])


def expected_age_10yr(group: str) -> str:
    low = lower_age(group) // 10 * 10
    return '80+' if low >= 80 else f'{low:02d}-{low + 9:02d}'


def expected_life_stage(group: str) -> str:
    low = lower_age(group)
    if low < 20:
        return '아동청소년'
    if low < 40:
        return '청년'
    if low < 65:
        return '중장년'
    return '고령'


def raw_keys(raw: pd.DataFrame) -> pd.DataFrame:
    """원본 문자열에서 집계 키를 문자열로 만든다."""
    weekday = {d: str(dt.date.fromisoformat(d).weekday()) for d in raw['기준일자'].unique()}
    return pd.DataFrame({
        'date': raw['기준일자'],
        'year': raw['기준일자'].str[:4].astype(int).astype(str),
        'month': raw['기준일자'].str[5:7].astype(int).astype(str),
        'weekday': raw['기준일자'].map(weekday),
        'gender_code': raw['성별'],
        'age_group_original': raw['연령대'],
        'life_stage': raw['연령대'].map(expected_life_stage),
        'origin_region_code': raw['거주지시군구코드'],
        'population': pd.to_numeric(raw['체류인구수']),
    })


def as_key_text(df: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    out = df[keys].copy()
    for k in keys:
        out[k] = out[k].dt.strftime('%Y-%m-%d') if k == 'date' else out[k].astype(str)
    return out


# ── 출력 도우미 ───────────────────────────────────────────────────────────────

class Report:
    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0

    def section(self, title: str) -> None:
        print(f'\n■ {title}')

    def check(self, ok: bool, message: str, detail: str = '') -> bool:
        ok = bool(ok)
        if ok:
            self.passed += 1
            print(f'  [통과] {message}')
        else:
            self.failed += 1
            print(f'  [실패] {message}' + (f' — {detail}' if detail else ''))
        return ok

    def note(self, message: str) -> None:
        print(f'  [참고] {message}')


def frames_differ(a: pd.DataFrame, b: pd.DataFrame) -> str | None:
    """두 표가 같으면 None, 다르면 어디가 다른지."""
    if list(a.columns) != list(b.columns):
        return f'컬럼이 다름 {list(a.columns)} / {list(b.columns)}'
    if len(a) != len(b):
        return f'행 수가 다름 {len(a)} / {len(b)}'
    for col in a.columns:
        x, y = a[col], b[col]
        if pd.api.types.is_numeric_dtype(x) and pd.api.types.is_numeric_dtype(y) \
                and not pd.api.types.is_bool_dtype(x):
            same = np.allclose(x.astype('float64'), y.astype('float64'), rtol=0, atol=1e-9, equal_nan=True)
        else:
            same = (x.isna() == y.isna()).all() and (x[x.notna()].astype(str) == y[y.notna()].astype(str)).all()
        if not same:
            return f'{col} 값이 다름'
    return None


def compare_parquet(r: Report, stem, label: str, csv_table: pd.DataFrame) -> None:
    if not stem.with_suffix('.parquet').exists():
        r.note(f'{label}: Parquet 파일이 없습니다 (pyarrow 없이 실행한 경우).')
    elif not parquet_available():
        r.note(f'{label}: pyarrow가 없어 Parquet 내용은 확인하지 못했습니다.')
    else:
        diff = frames_differ(csv_table, read_table(stem, prefer='parquet'))
        r.check(diff is None, f'{label}: CSV와 Parquet 내용이 같다', diff or '')


def describe_ranges(dates: list[str]) -> str:
    if not dates:
        return '없음'
    days = [dt.date.fromisoformat(d) for d in sorted(dates)]
    ranges, start = [], days[0]
    for prev, cur in zip(days, days[1:] + [None]):
        if cur is None or (cur - prev).days != 1:
            ranges.append(f'{start}' if start == prev else f'{start} ~ {prev}')
            start = cur
    return ', '.join(ranges) + f' ({len(days)}일)'


# ── 검증 ─────────────────────────────────────────────────────────────────────

def check_raw(r: Report) -> pd.DataFrame | None:
    r.section('원본 파일 (변경 여부)')
    if not r.check(RAW_CSV.exists(), f'원본이 있다: {rel(RAW_CSV)}'):
        return None
    digest = sha256(RAW_CSV)
    r.check(digest == ANALYSIS_SHA256, 'ANALYSIS.md에 기록된 원본과 SHA-256이 같다', digest)
    if PROCESSED_MANIFEST.exists():
        r.check(read_json(PROCESSED_MANIFEST)['source']['sha256'] == digest,
                '전처리할 때 읽은 원본과 지금 원본이 같다')
    if AGGREGATES_MANIFEST.exists():
        r.check(read_json(AGGREGATES_MANIFEST)['source']['sha256'] == digest,
                '집계할 때 기준이 된 원본과 지금 원본이 같다')
    raw = pd.read_csv(RAW_CSV, encoding='utf-8-sig', dtype=str, keep_default_na=False)
    r.check(list(raw.columns) == RAW_COLUMNS, '원본 컬럼 6개가 그대로다', str(list(raw.columns)))
    return raw


def check_processed(r: Report, raw: pd.DataFrame) -> pd.DataFrame | None:
    r.section('전처리 결과 (data/processed/stay_population)')
    if not r.check(PROCESSED_STEM.with_suffix('.csv').exists(), 'CSV가 있다'):
        return None
    df = read_table(PROCESSED_STEM, prefer='csv')
    compare_parquet(r, PROCESSED_STEM, 'stay_population', df)

    r.check(list(df.columns) == PROCESSED_COLUMNS, '컬럼 구성이 약속한 대로다', str(list(df.columns)))
    if not r.check(len(df) == len(raw), f'행 수가 원본과 같다 ({len(raw):,}행)', f'{len(df):,}행'):
        return None
    nulls = df.isna().sum()
    r.check(nulls.sum() == 0, '빈 값이 없다', str(nulls[nulls > 0].to_dict()))
    r.check((df['source_row'].to_numpy() == np.arange(1, len(raw) + 1)).all(), 'source_row가 원본 행 번호 1..N 이다')

    date_text = df['date'].dt.strftime('%Y-%m-%d')
    r.check((date_text == raw['기준일자']).all(), 'date = 원본 기준일자')
    r.check((df['stay_region_code'] == raw['체류지시군구코드']).all()
            and (df['origin_region_code'] == raw['거주지시군구코드']).all(),
            '체류지·거주지 코드가 원본 문자열 그대로다 (5자리 유지)')
    r.check((df['gender_code'] == raw['성별']).all(), 'gender_code = 원본 성별')
    r.check((df['age_group_original'] == raw['연령대']).all(), 'age_group_original = 원본 연령대')
    r.check((df['population'].to_numpy() == pd.to_numeric(raw['체류인구수']).to_numpy()).all(),
            'population = 원본 체류인구수 (값 변경 없음)')

    r.check((df['year'].astype(str) == raw['기준일자'].str[:4]).all()
            and (df['month'] == raw['기준일자'].str[5:7].astype(int)).all()
            and (df['day'] == raw['기준일자'].str[8:10].astype(int)).all(), 'year / month / day')
    weekday = raw['기준일자'].map({d: dt.date.fromisoformat(d).weekday() for d in raw['기준일자'].unique()})
    r.check((df['weekday'] == weekday).all(), 'weekday (0 = 월요일)')
    r.check((df['weekday_name'] == weekday.map(dict(enumerate('월화수목금토일')))).all(), 'weekday_name')
    r.check((df['is_weekend'] == weekday.isin([5, 6])).all(), 'is_weekend = 토·일')
    r.check((df['gender_label'] == raw['성별'].map({'male': '남성', 'female': '여성'})).all(),
            'gender_label: male → 남성, female → 여성')
    r.check((df['age_group_10yr'] == raw['연령대'].map(expected_age_10yr)).all(), 'age_group_10yr')
    r.check((df['life_stage'] == raw['연령대'].map(expected_life_stage)).all(),
            'life_stage: 0~19 아동청소년 / 20~39 청년 / 40~64 중장년 / 65+ 고령')
    r.check((df['is_zero'] == (df['population'] == 0)).all(), 'is_zero')
    r.check((df['is_capped'] == np.isclose(df['population'], CAP_VALUE, rtol=0, atol=1e-9)).all(), 'is_capped')
    r.check((df['is_same_region'] == (raw['거주지시군구코드'] == raw['체류지시군구코드'])).all(), 'is_same_region')
    return df


def check_regions(r: Report, df: pd.DataFrame) -> pd.DataFrame:
    r.section('행정구역 매핑 (data/reference/region_codes.csv)')
    regions = read_region_codes()
    code = regions['region_code']
    r.check(code.is_unique, 'region_code가 겹치지 않는다 (JOIN해도 행이 늘지 않음)')
    r.check(code.str.fullmatch(r'\d{5}').all(), 'region_code가 모두 5자리 숫자 문자열이다')
    r.check((regions['sido_code'] == code.str[:2]).all(), 'sido_code = region_code 앞 두 자리')
    r.check((regions['region_name'] == regions['sido_name'] + ' ' + regions['sigungu_name']).all(),
            'region_name = sido_name + sigungu_name')
    blank = (regions[['sido_name', 'sigungu_name', 'city_code', 'city_name', 'origin_zone']] == '').sum().sum()
    r.check(blank == 0, '이름·권역에 빈 값이 없다')
    gu = regions[regions['is_general_gu']]
    r.check((gu['sigungu_name'].str.split(' ').str[0] == gu['city_name']).all()
            and (gu['city_code'] != gu['region_code']).all(), '일반구는 상위 시(city_code·city_name)로 묶인다')
    for col in ('origin_region_code', 'stay_region_code'):
        missing = sorted(set(df[col]) - set(code))
        r.check(not missing, f'{col} 전부가 매핑 표에 있다 (JOIN 누락 0)', str(missing))
    joined = df[['origin_region_code']].merge(code.rename('origin_region_code').to_frame(), how='left',
                                              on='origin_region_code', indicator=True)
    r.check(len(joined) == len(df) and (joined['_merge'] == 'both').all(),
            f'거주지 JOIN 결과가 {len(df):,}행 그대로다')
    home = regions.loc[code == '47150', 'region_name']
    r.check(list(home) == ['경상북도 김천시'], '47150 = 경상북도 김천시')
    return regions


def check_aggregates(r: Report, raw: pd.DataFrame, df: pd.DataFrame, regions: pd.DataFrame) -> None:
    r.section('집계표 (data/processed/aggregates)')
    if not r.check(AGGREGATES_MANIFEST.exists(), 'manifest.json이 있다'):
        return
    manifest = read_json(AGGREGATES_MANIFEST)
    r.check(set(manifest['tables']) == set(AGGREGATE_KEYS), f'집계표 {len(AGGREGATE_KEYS)}종이 모두 있다',
            str(sorted(set(AGGREGATE_KEYS) ^ set(manifest['tables']))))

    base = raw_keys(raw)
    total = float(df['population'].sum())
    external_total = float(df.loc[~df['is_same_region'], 'population'].sum())
    nonzero_total = int((~df['is_zero']).sum())
    capped_total = int(df['is_capped'].sum())
    names = regions.drop_duplicates('region_code').set_index('region_code')

    for name, keys in AGGREGATE_KEYS.items():
        stem = AGGREGATES_DIR / name
        print(f'  · {name}')
        if not r.check(stem.with_suffix('.csv').exists(), f'{name}.csv가 있다'):
            continue
        table = read_table(stem, prefer='csv')
        compare_parquet(r, stem, name, table)
        r.check(len(table) == manifest['tables'].get(name, {}).get('rows'), f'{name}: manifest 행 수와 같다')
        r.check(not table.duplicated(keys).any(), f'{name}: 키 {keys}가 겹치지 않는다')

        filled = table[table['has_data']] if 'has_data' in table.columns else table
        r.check(filled['row_count'].sum() == len(df) and filled['nonzero_rows'].sum() == nonzero_total
                and filled['capped_rows'].sum() == capped_total,
                f'{name}: 행 수·0 아닌 행 수·상한값 행 수 합계가 전체와 같다')
        r.check(abs(filled['population_sum'].sum() - total) < SUM_TOL
                and abs(filled['external_population_sum'].sum() - external_total) < SUM_TOL,
                f'{name}: 체류인구수 합계가 전체({total:,.2f})와 같다',
                f'{filled["population_sum"].sum():,.2f}')
        share_tol = len(filled) * 5e-7 + 1e-9
        r.check(abs(filled['share_of_total'].sum() - 1) <= share_tol, f'{name}: share_of_total 합이 1이다')
        if 'share_within_group' in table.columns:
            sums = filled.groupby(keys[0])['share_within_group'].sum()
            sizes = filled.groupby(keys[0]).size()
            r.check(((sums - 1).abs() <= sizes * 5e-7 + 1e-9).all(), f'{name}: 그룹 안 비중(share_within_group) 합이 1이다')

        # 원본에서 직접 다시 센 값과 비교
        expected = base.groupby(keys).agg(
            row_count=('population', 'size'),
            nonzero_rows=('population', lambda s: int((s > 0).sum())),
            population_sum=('population', 'sum'),
        ).reset_index()
        got = as_key_text(filled, keys).join(filled[['row_count', 'nonzero_rows', 'population_sum']])
        merged = expected.merge(got, on=keys, how='outer', suffixes=('_raw', ''), indicator=True)
        only = merged[merged['_merge'] != 'both']
        r.check(only.empty, f'{name}: 원본에 있는 조합만, 빠짐없이 들어 있다 ({len(expected):,}개)',
                f'차이 {len(only)}개 예: {only[keys].head(3).to_dict("records")}')
        both = merged[merged['_merge'] == 'both']
        r.check((both['row_count_raw'] == both['row_count']).all()
                and (both['nonzero_rows_raw'] == both['nonzero_rows']).all()
                and np.allclose(both['population_sum_raw'], both['population_sum'], rtol=0, atol=0.006),
                f'{name}: 조합마다 원본에서 다시 센 값과 같다')

        if 'origin_region_code' in table.columns:
            code = table['origin_region_code']
            r.check((table['sido_name'] == code.map(names['sido_name'])).all()
                    and (table['sigungu_name'] == code.map(names['sigungu_name'])).all(),
                    f'{name}: 지역 이름이 매핑 표와 같다')

        if name == 'daily':
            calendar = pd.date_range(df['date'].min(), df['date'].max())
            r.check(list(table['date']) == list(calendar), f'daily: 달력상 모든 날짜({len(calendar)}일)가 순서대로 있다')
            empty = table[~table['has_data']]
            r.check(set(table.loc[table['has_data'], 'date'].dt.strftime('%Y-%m-%d')) == set(raw['기준일자']),
                    'daily: has_data = 원본에 그 날짜가 있음')
            r.check(empty['population_sum'].isna().all() and (empty['row_count'] == 0).all(),
                    'daily: 데이터 없는 날은 0이나 보간값이 아니라 빈 값이다')
        if name in ('monthly', 'weekday'):
            with_days = filled[filled['days_with_data'] > 0]
            r.check(filled['days_with_data'].sum() == raw['기준일자'].nunique()
                    and np.allclose(with_days['daily_mean'], with_days['population_sum'] / with_days['days_with_data'],
                                    rtol=0, atol=1e-4),
                    f'{name}: days_with_data 합 = 데이터 있는 날 수, daily_mean = 합계 ÷ 날 수')
        if name == 'origin_region':
            top = table.loc[table['population_rank'] == 1, 'population_sum']
            r.check(len(top) >= 1 and top.iloc[0] == table['population_sum'].max(), 'origin_region: 순위 1위가 최대 합계다')


def check_web_data(r: Report, df: pd.DataFrame, regions: pd.DataFrame) -> None:
    r.section('웹 서비스용 데이터 (web/public/data/population.json)')
    if not WEB_DATA.exists():
        r.note('파일이 없습니다. python scripts/build_web_data.py 로 만듭니다.')
        return
    with open(WEB_DATA, encoding='utf-8') as f:
        web = json.load(f)
    r.check(web['source']['sha256'] == sha256(RAW_CSV), '지금 원본에서 만든 데이터다 (SHA-256)')
    cols = web['rows']
    lengths = {k: len(v) for k, v in cols.items() if k != 'n'}
    r.check(set(lengths.values()) == {cols['n']} and cols['n'] == len(df),
            f'행 수가 전처리 결과와 같다 ({len(df):,}행)', str(lengths))
    r.check([x['code'] for x in web['regions']] == sorted(regions['region_code']),
            '거주지 목록이 매핑 표(region_codes.csv)와 같다')
    try:
        rebuilt = pd.DataFrame({
            'date': [web['dates'][i] for i in cols['date']],
            'origin_region_code': [web['regions'][i]['code'] for i in cols['region']],
            'gender_code': [web['genders'][i]['code'] for i in cols['gender']],
            'age_group_original': [web['ages'][i]['code'] for i in cols['age']],
            'pop100': cols['pop100'],
        })
    except (IndexError, KeyError) as e:
        r.check(False, '번호가 모두 목록 안을 가리킨다', repr(e))
        return
    expected = pd.DataFrame({
        'date': df['date'].dt.strftime('%Y-%m-%d'),
        'origin_region_code': df['origin_region_code'],
        'gender_code': df['gender_code'],
        'age_group_original': df['age_group_original'],
        'pop100': (df['population'] * 100).round().astype('int64'),
    })
    keys = list(expected.columns)
    same = rebuilt.sort_values(keys).reset_index(drop=True).equals(
        expected.sort_values(keys).reset_index(drop=True).astype(rebuilt.dtypes.to_dict()))
    r.check(same, '모든 행(날짜·거주지·성별·연령대·체류인구수)이 전처리 결과와 같다')
    r.check(abs(sum(cols['pop100']) / 100 - float(df['population'].sum())) < SUM_TOL, '체류인구수 합계가 같다')


def notes(r: Report, raw: pd.DataFrame, df: pd.DataFrame) -> None:
    r.section('참고: 데이터 특성 (ANALYSIS.md와 같은 내용, 실패 아님)')
    calendar = pd.date_range(df['date'].min(), df['date'].max()).strftime('%Y-%m-%d')
    missing = sorted(set(calendar) - set(raw['기준일자']))
    total = df['population'].sum()
    same = df[df['is_same_region']]
    capped = df[df['is_capped']]
    hwaseong = df['origin_region_code'].isin(['41590', '41591', '41593', '41595', '41597'])
    r.note(f'데이터 없는 날짜: {describe_ranges(missing)}')
    r.note(f'체류인구수 0인 행: {df["is_zero"].sum():,}행 ({df["is_zero"].mean():.2%})')
    r.note(f'김천시 자체(거주지 47150) 행: {len(same):,}행, 합계의 {same["population"].sum() / total:.1%}')
    r.note(f'상한값 {CAP_VALUE:,} 행: {len(capped):,}행, 합계의 {capped["population"].sum() / total:.1%}')
    r.note(f'화성시 41590과 일반구 코드가 함께 있음: {hwaseong.sum():,}행 — 시 단위는 city_code로 합칠 것')


def main() -> int:
    r = Report()
    print(f'※ {NOTICE}')
    raw = check_raw(r)
    if raw is not None:
        df = check_processed(r, raw)
        if df is not None:
            regions = check_regions(r, df)
            check_aggregates(r, raw, df, regions)
            check_web_data(r, df, regions)
            notes(r, raw, df)
    print(f'\n결과: 통과 {r.passed}개, 실패 {r.failed}개')
    return 1 if r.failed or raw is None else 0


if __name__ == '__main__':
    sys.exit(main())
