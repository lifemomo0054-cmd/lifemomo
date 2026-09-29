"""분석용 행 단위 데이터 → 웹 서비스용 데이터 (web/public/data/population.json)

웹에서는 필터(기간·성별·연령·거주지역)를 어떻게 조합해도 모든 지표가 같이 바뀌어야 하므로,
미리 만든 집계표 대신 행 단위 데이터를 작게 줄여서 보낸다.

- 행은 날짜·거주지·성별·연령대 번호와 체류인구수로만 적는다(열 단위 배열).
- 체류인구수는 100을 곱한 정수(pop100)로 적는다. 원본이 소수 둘째 자리까지라 손실이 없고,
  브라우저에서 더할 때 소수 오차가 생기지 않는다.
- 행과 값은 빼거나 고치지 않는다. 0인 행도 그대로 둔다.

preprocess.py 를 먼저 실행해야 한다. 이 데이터는 합성데이터다. 공식통계가 아니다.

    python scripts/build_web_data.py
"""

from __future__ import annotations

import json
import sys

from common import (
    AGE_GROUPS,
    CAP_VALUE,
    GENDER_LABELS,
    GENDER_ORDER,
    LIFE_STAGES,
    NOTICE,
    PROCESSED_MANIFEST,
    PROCESSED_STEM,
    ROOT,
    read_json,
    read_region_codes,
    read_table,
    rel,
)

WEB_DATA = ROOT / 'web' / 'public' / 'data' / 'population.json'
ZONE_ORDER = ['김천시(자체)', '김천 인접 시군', '대구', '경북 기타', '수도권', '기타 지역']


def build() -> dict:
    manifest = read_json(PROCESSED_MANIFEST)
    df = read_table(PROCESSED_STEM)
    regions = read_region_codes().sort_values('region_code').reset_index(drop=True)
    if set(regions['origin_zone']) != set(ZONE_ORDER):
        raise ValueError(f'권역 이름이 예상과 다릅니다: {sorted(set(regions["origin_zone"]))}')

    date_text = df['date'].dt.strftime('%Y-%m-%d')
    dates = sorted(date_text.unique())
    date_index = {d: i for i, d in enumerate(dates)}
    region_index = {c: i for i, c in enumerate(regions['region_code'])}
    age_index = {a: i for i, a in enumerate(AGE_GROUPS)}
    gender_index = {g: i for i, g in enumerate(GENDER_ORDER)}

    rows = df.assign(
        d=date_text.map(date_index),
        r=df['origin_region_code'].map(region_index),
        g=df['gender_code'].map(gender_index),
        a=df['age_group_original'].map(age_index),
        p=(df['population'] * 100).round().astype('int64'),
    )
    if rows[['d', 'r', 'g', 'a']].isna().any().any():
        raise ValueError('번호로 바꾸지 못한 값이 있습니다. region_codes.csv 와 전처리 결과를 확인하세요.')
    if ((rows['p'] / 100 - rows['population']).abs() > 1e-6).any():
        raise ValueError('체류인구수가 소수 둘째 자리를 넘습니다. pop100 으로 옮기면 값이 바뀝니다.')
    rows = rows.sort_values(['d', 'r', 'g', 'a'], kind='stable')

    stay = df['stay_region_code'].unique()
    if len(stay) != 1:
        raise ValueError(f'체류지가 하나가 아닙니다: {list(stay)}')
    stay_name = regions.loc[regions['region_code'] == stay[0], 'region_name'].item()

    sidos = regions[['sido_code', 'sido_name', 'sido_short_name']].drop_duplicates().sort_values('sido_code')
    return {
        'version': 1,
        'notice': NOTICE,
        'source': {'file': manifest['source']['file'], 'sha256': manifest['source']['sha256']},
        'stayRegion': {'code': stay[0], 'name': stay_name},
        'calendar': {'start': date_text.min(), 'end': date_text.max()},
        'capValue': CAP_VALUE,
        'dates': dates,
        'genders': [{'code': g, 'label': GENDER_LABELS[g]} for g in GENDER_ORDER],
        'ages': [{'code': a, 'age10': v[0], 'lifeStage': v[1], 'band': v[2]} for a, v in AGE_GROUPS.items()],
        'lifeStages': [{'name': k, 'range': v} for k, v in LIFE_STAGES.items()],
        'zones': ZONE_ORDER,
        'sidos': [{'code': c, 'name': n, 'short': s} for c, n, s in sidos.itertuples(index=False)],
        'regions': [
            {
                'code': r.region_code, 'name': r.sigungu_name, 'full': r.region_name, 'sido': r.sido_code,
                'city': r.city_code, 'cityName': r.city_name, 'zone': r.origin_zone,
                'adjacent': bool(r.is_adjacent_to_gimcheon), 'capital': bool(r.is_capital_area),
            }
            for r in regions.itertuples(index=False)
        ],
        'rows': {
            'n': len(rows),
            'date': rows['d'].astype(int).tolist(),
            'region': rows['r'].astype(int).tolist(),
            'gender': rows['g'].astype(int).tolist(),
            'age': rows['a'].astype(int).tolist(),
            'pop100': rows['p'].astype(int).tolist(),
        },
    }


def main() -> int:
    if not PROCESSED_MANIFEST.exists():
        print('전처리 결과가 없습니다. 먼저 python scripts/preprocess.py 를 실행하세요.', file=sys.stderr)
        return 1
    data = build()
    WEB_DATA.parent.mkdir(parents=True, exist_ok=True)
    with open(WEB_DATA, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    total = sum(data['rows']['pop100']) / 100
    print(f'  → {rel(WEB_DATA)} ({data["rows"]["n"]:,}행, 합계 {total:,.2f}, {WEB_DATA.stat().st_size:,} bytes)')
    print(f'※ {NOTICE}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
