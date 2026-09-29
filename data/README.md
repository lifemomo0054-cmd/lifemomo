# 김천시 3시간 이상 체류 생활인구 — 전처리 데이터

> [!WARNING]
> **합성데이터입니다. 공식통계가 아닙니다.**
> 이 폴더의 모든 파일은 합성데이터에서 만든 것이며 김천시의 실제 체류인구·생활인구를 나타내지 않습니다.
> 정책 판단·보도·대외 자료의 근거로 쓰지 말고, 화면이나 보고서에 쓸 때는 "합성데이터"라고 함께 적어 주세요.
> 데이터의 특성과 한계는 [ANALYSIS.md](../ANALYSIS.md)에 정리되어 있습니다.

## 폴더 구성

```
data/
├── raw/                         원본 (받은 그대로, 수정 금지)
│   └── 경상북도 김천시_3시간이상체류_생활인구 합성데이터.csv
├── reference/
│   └── region_codes.csv         행정구역 코드 매핑 표 (JOIN용)
└── processed/                   스크립트가 만드는 결과 (직접 고치지 말고 다시 생성)
    ├── stay_population.csv / .parquet    행 단위 분석용 데이터 (80,193행)
    ├── manifest.json                     원본 SHA-256, 행 수, 요약
    └── aggregates/                       집계표 11종 (.csv / .parquet) + manifest.json
```

- CSV는 엑셀에서 한글이 깨지지 않도록 UTF-8(BOM 포함)으로 저장합니다.
- 원본은 `.gitattributes`에서 줄바꿈 변환을 막아 두었고, 스크립트는 원본을 읽기만 합니다.

## 실행

Python 3.9 이상이 필요합니다.

```bash
pip install -r requirements.txt     # pandas, pyarrow

python scripts/preprocess.py        # 원본 → processed/stay_population
python scripts/aggregate.py         # stay_population → processed/aggregates/*
python scripts/build_web_data.py    # stay_population → web/public/data/population.json (웹서비스용)
python scripts/validate.py          # 원본·결과를 서로 대조 (실패 시 종료 코드 1)
```

- Windows에서 `python`이 안 되면 `py`로 바꿔서 실행하세요 (예: `py scripts/preprocess.py`).
- pyarrow가 없으면 Parquet은 건너뛰고 CSV만 만듭니다. `--no-parquet`으로 일부러 끌 수도 있습니다.
- 같은 원본으로 다시 실행하면 결과 파일이 바이트 단위까지 똑같이 나옵니다.

## 처리 규칙

[ANALYSIS.md 14-1](../ANALYSIS.md#14-1-먼저-정해야-할-전처리-규칙)의 선택지를 이렇게 정했습니다.

| 항목 | 처리 |
|---|---|
| 행 삭제·값 수정 | **하지 않음.** 원본 80,193행과 값을 그대로 두고 컬럼만 덧붙임 |
| 김천시 자체(거주지 47150) 행 | 합계에 포함. `is_same_region`으로 표시하고, 집계표에 이 행들을 뺀 `external_population_sum`을 함께 둠 |
| 상한값 5,932.84 | 그대로 둠. `is_capped`로 표시하고, 집계표에 `capped_rows`를 둠 |
| 화성시 41590 + 일반구 코드 | 코드 그대로 둠. 시 단위로 합칠 때는 매핑 표의 `city_code` 사용 |
| 5월(데이터 없음) | `daily`·`monthly`에 `has_data = False`인 빈 행으로 둠. 0으로 채우거나 보간하지 않음 |
| 원본에 없는 조합 | 0으로 채우지 않음. 행이 있는 조합만 집계 |
| 지역 이름 | 원본에는 코드만 있음. `reference/region_codes.csv`와 JOIN |

## 행 단위 데이터 — `processed/stay_population`

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `source_row` | 정수 | 원본 CSV의 데이터 행 번호 (헤더 제외, 1부터) |
| `date` | 날짜 | 원본 `기준일자` |
| `year` / `month` / `day` | 정수 | 날짜에서 뽑은 연·월·일 |
| `weekday` | 정수 | 요일 번호, **0 = 월요일 … 6 = 일요일** |
| `weekday_name` | 문자 | `월` `화` `수` `목` `금` `토` `일` |
| `is_weekend` | 참/거짓 | 토·일이면 참 (공휴일은 반영하지 않음) |
| `stay_region_code` | 문자(5자리) | 원본 `체류지시군구코드` (모두 47150) |
| `origin_region_code` | 문자(5자리) | 원본 `거주지시군구코드` — `region_codes.csv`의 `region_code`와 JOIN |
| `is_same_region` | 참/거짓 | 거주지 = 체류지 (김천시 자체) |
| `gender_code` | 문자 | 원본 `성별` 값 그대로 (`male` / `female`) |
| `gender_label` | 문자 | 화면 표시용 (`남성` / `여성`) |
| `age_group_original` | 문자 | 원본 `연령대` 그대로 (16구간) |
| `age_group_10yr` | 문자 | 10세 단위: `00-09` `10-19` … `70-79` `80+` |
| `life_stage` | 문자 | 생애단계 (아래 표) |
| `population` | 실수 | 원본 `체류인구수` 그대로 |
| `is_zero` | 참/거짓 | 체류인구수가 0 (0과 3 사이 값이 없어 "3 미만"일 수도 있음) |
| `is_capped` | 참/거짓 | 체류인구수가 상한값 5,932.84 |

생애단계는 원본 5세 구간 경계와 딱 맞게 나뉩니다.

| `life_stage` | 나이 | 원본 연령대 |
|---|---|---|
| 아동청소년 | 0~19세 | `00-09` `10-14` `15-19` |
| 청년 | 20~39세 | `20-24` `25-29` `30-34` `35-39` |
| 중장년 | 40~64세 | `40-44` `45-49` `50-54` `55-59` `60-64` |
| 고령 | 65세 이상 | `65-69` `70-74` `75-79` `80+` |

`00-09`만 10년 폭이라 `age_group_10yr`에서도 그대로 `00-09`입니다. `60-69`는 생애단계로는 중장년(60-64)과 고령(65-69)에 걸칩니다.

## 행정구역 매핑 표 — `reference/region_codes.csv`

원본에 나오는 256개 코드(체류지 1개 포함)를 모두 담고 있습니다. `region_code`는 겹치지 않으므로 JOIN해도 행이 늘지 않습니다.

| 컬럼 | 설명 |
|---|---|
| `region_code` | 5자리 시군구 코드 (JOIN 키) |
| `sido_code` / `sido_name` / `sido_short_name` | 시도 코드·이름·줄임말 (예: `47` / `경상북도` / `경북`) |
| `sigungu_name` | 시군구 이름. 일반구는 `수원시 장안구`처럼 시 이름 포함 |
| `region_name` | 전체 이름 (예: `경상북도 구미시`) |
| `city_code` / `city_name` | 시 단위로 묶을 때 쓰는 코드·이름. 일반구는 상위 시(예: 41111 → 41110 수원시), 나머지는 자기 자신 |
| `is_general_gu` | 일반구 여부 |
| `is_capital_area` | 수도권(서울·인천·경기) 여부 |
| `is_adjacent_to_gimcheon` | 김천시와 경계를 맞댄 시군 여부 |
| `origin_zone` | 김천 기준 권역: `김천시(자체)` / `김천 인접 시군` / `대구` / `경북 기타` / `수도권` / `기타 지역` |
| `note` | 참고 사항 (화성시 코드, 군위군 편입 등) |

- `city_code`는 묶음용 키입니다. 일반구로 나뉜 시(41110 수원시 등)는 이 표에 따로 행이 없습니다. 화성시만 원본에 `41590`이 직접 나와서 행이 있습니다.
- 김천 인접 시군(7곳): 구미시·칠곡군·성주군·상주시(경북), 거창군(경남), 무주군(전북), 영동군(충북).
- 화성시 일반구 코드(2026-02-01 신설): 41591 만세구, 41593 효행구, 41595 병점구, 41597 동탄구.
- 코드 체계는 원본을 따릅니다(강원 51, 전북 52, 군위군 27720). 공식 코드표가 바뀌면 이 파일을 고친 뒤 `aggregate.py`와 `validate.py`를 다시 실행하세요.

JOIN 예시 (pandas):

```python
import pandas as pd
df = pd.read_parquet('data/processed/stay_population.parquet')
regions = pd.read_csv('data/reference/region_codes.csv', dtype=str, encoding='utf-8-sig')
df = df.merge(regions, left_on='origin_region_code', right_on='region_code', how='left', validate='many_to_one')
```

## 집계표 — `processed/aggregates/`

| 파일 | 키 | 행 수 | 설명 |
|---|---|---:|---|
| `daily` | `date` | 181 | 달력상 모든 날짜. 데이터 없는 날(5월)은 `has_data = False`, 값은 빈칸 |
| `monthly` | `year`, `month` | 6 | 5월 포함. `daily_mean` = 합계 ÷ 데이터 있는 날 수 |
| `weekday` | `weekday` | 7 | `daily_mean` = 합계 ÷ 그 요일의 데이터 있는 날 수 |
| `gender` | `gender_code` | 2 | `gender_label` 포함 |
| `age` | `age_group_original` | 16 | `age_group_10yr`, `life_stage`, `age_band_years`(구간 폭) 포함 |
| `life_stage` | `life_stage` | 4 | `age_range` 포함 |
| `origin_region` | `origin_region_code` | 256 | 지역 이름·권역, `population_rank`(합계 순위) 포함 |
| `origin_region_age` | `origin_region_code`, `age_group_original` | 4,081 | 행이 있는 조합만 |
| `origin_region_gender` | `origin_region_code`, `gender_code` | 512 | |
| `date_age` | `date`, `age_group_original` | 2,399 | 데이터 있는 날만 |
| `date_gender` | `date`, `gender_code` | 300 | 데이터 있는 날만 |

모든 집계표에 공통으로 들어 있는 지표:

| 컬럼 | 설명 |
|---|---|
| `row_count` | 집계에 들어간 원본 행 수 |
| `nonzero_rows` / `zero_ratio` | 0보다 큰 행 수 / 0인 행 비율 |
| `population_sum` | 체류인구수 합계. 날짜별 값을 더한 "연인원" 성격이라 **실제 사람 수가 아님** |
| `population_mean` / `population_median` | 행당 평균 / 중앙값. 0이 77%라 중앙값은 대부분 0 |
| `nonzero_median` | 0을 뺀 중앙값 |
| `external_population_sum` | 김천시 자체(거주지 47150) 행을 뺀 합계 |
| `capped_rows` | 상한값(5,932.84) 행 수 |
| `share_of_total` | 전체 합계 대비 비중 |
| `share_within_group` | (두 키 집계만) 첫 번째 키(거주지 또는 날짜) 안에서의 비중 |

- 합계는 소수 둘째 자리, 평균·중앙값은 넷째 자리, 비율은 여섯째 자리에서 반올림합니다.
- 날짜마다 기록된 행 수가 228~1,263행으로 달라서, 일별 합계의 오르내림을 실제 변화로 해석하기 어렵습니다. (ANALYSIS.md 13-7)

## 검증 — `scripts/validate.py`

전처리·집계 코드를 다시 쓰지 않고 **원본 문자열에서 직접 다시 계산해서** 대조합니다.

- 원본 SHA-256이 ANALYSIS.md에 적힌 값, 전처리·집계할 때 값과 모두 같은지 (원본 변경 여부)
- 행 단위 데이터가 원본과 행 수·값이 같은지, 파생 컬럼(날짜·요일·연령대·생애단계·성별 표시명·표시 컬럼)이 맞는지
- 매핑 표의 코드가 겹치지 않고, 원본의 모든 코드가 JOIN되는지
- 집계표 11종이 모두 있고, CSV와 Parquet이 같고, 합계·행 수가 전체와 맞고, 조합마다 원본에서 다시 센 값과 같은지
- 웹서비스용 데이터(`web/public/data/population.json`)의 모든 행이 전처리 결과와 같은지

## 참고 자료

- 화성시 일반구 코드: [화성시 4개 구 코드 추가 (GitHub PR)](https://github.com/jaejui45/realestate_korea_apartment/pull/2), [화성특례시 4개 일반구 체제 출범 (경기일보)](https://www.kyeonggi.com/article/20260120580382)
- 김천시 인접 시군: [김천시 — 위키백과](https://ko.wikipedia.org/wiki/%EA%B9%80%EC%B2%9C%EC%8B%9C)
