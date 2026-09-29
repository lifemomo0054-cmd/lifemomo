"""전처리·집계·검증 스크립트가 함께 쓰는 경로, 상수, 파일 입출력.

이 데이터는 합성데이터다. 공식통계가 아니다. (ANALYSIS.md 참고)
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW_CSV = ROOT / 'data' / 'raw' / '경상북도 김천시_3시간이상체류_생활인구 합성데이터.csv'
REGION_CODES_CSV = ROOT / 'data' / 'reference' / 'region_codes.csv'
PROCESSED_DIR = ROOT / 'data' / 'processed'
PROCESSED_STEM = PROCESSED_DIR / 'stay_population'  # .csv / .parquet
PROCESSED_MANIFEST = PROCESSED_DIR / 'manifest.json'
AGGREGATES_DIR = PROCESSED_DIR / 'aggregates'
AGGREGATES_MANIFEST = AGGREGATES_DIR / 'manifest.json'

NOTICE = (
    '합성데이터입니다. 공식통계가 아니며 김천시의 실제 체류인구·생활인구를 나타내지 않습니다. '
    '정책 판단·보도·대외 자료의 근거로 쓰지 마세요.'
)

RAW_COLUMNS = ['기준일자', '체류지시군구코드', '거주지시군구코드', '성별', '연령대', '체류인구수']

# 최댓값 5,932.84가 36번 반복된다 → 상한에서 잘라 낸 값으로 보고 표시만 한다. (ANALYSIS.md 13-1)
CAP_VALUE = 5932.84

GENDER_LABELS = {'male': '남성', 'female': '여성'}
GENDER_ORDER = ['male', 'female']

WEEKDAY_NAMES = ['월', '화', '수', '목', '금', '토', '일']  # 0 = 월요일

# 원본 연령대 → (10세 단위 연령대, 생애단계, 구간 폭(년)). 순서가 곧 나이 순서다.
# 00-09만 10년 폭이고 80+는 상한이 없다. (ANALYSIS.md 8)
AGE_GROUPS = {
    '00-09': ('00-09', '아동청소년', 10),
    '10-14': ('10-19', '아동청소년', 5),
    '15-19': ('10-19', '아동청소년', 5),
    '20-24': ('20-29', '청년', 5),
    '25-29': ('20-29', '청년', 5),
    '30-34': ('30-39', '청년', 5),
    '35-39': ('30-39', '청년', 5),
    '40-44': ('40-49', '중장년', 5),
    '45-49': ('40-49', '중장년', 5),
    '50-54': ('50-59', '중장년', 5),
    '55-59': ('50-59', '중장년', 5),
    '60-64': ('60-69', '중장년', 5),
    '65-69': ('60-69', '고령', 5),
    '70-74': ('70-79', '고령', 5),
    '75-79': ('70-79', '고령', 5),
    '80+': ('80+', '고령', None),
}
AGE_ORDER = list(AGE_GROUPS)
AGE_10YR_ORDER = list(dict.fromkeys(v[0] for v in AGE_GROUPS.values()))
LIFE_STAGES = {  # 생애단계 → 나이 범위 표시
    '아동청소년': '0~19세',
    '청년': '20~39세',
    '중장년': '40~64세',
    '고령': '65세 이상',
}
LIFE_STAGE_ORDER = list(LIFE_STAGES)


def rel(path: Path) -> str:
    """저장소 루트 기준 상대 경로 (manifest·메시지용)."""
    try:
        return Path(path).resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def parquet_available() -> bool:
    try:
        import pyarrow  # noqa: F401
    except ImportError:
        return False
    return True


def write_table(df: pd.DataFrame, stem: Path, parquet: bool) -> list[str]:
    """stem.csv(엑셀에서 한글이 깨지지 않도록 BOM 포함)와, 가능하면 stem.parquet을 쓴다."""
    stem.parent.mkdir(parents=True, exist_ok=True)
    csv_path = stem.with_suffix('.csv')
    df.to_csv(csv_path, index=False, encoding='utf-8-sig', lineterminator='\n')
    written = [rel(csv_path)]
    parquet_path = stem.with_suffix('.parquet')
    if not parquet and parquet_path.exists():
        # 예전에 만든 Parquet이 남으면 새 CSV와 내용이 달라지므로 지운다
        parquet_path.unlink()
        print(f'  (예전 Parquet 삭제: {rel(parquet_path)})')
    if parquet:
        import pyarrow as pa
        import pyarrow.parquet as pq

        out = df.copy()
        if 'date' in out.columns:  # 시각 없이 날짜만 (Parquet date32)
            out['date'] = pd.to_datetime(out['date']).dt.date
        table = pa.Table.from_pandas(out, preserve_index=False)
        meta = dict(table.schema.metadata or {})
        meta[b'notice'] = NOTICE.encode('utf-8')
        pq.write_table(table.replace_schema_metadata(meta), parquet_path)
        written.append(rel(parquet_path))
    return written


def read_table(stem: Path, prefer: str = 'parquet') -> pd.DataFrame:
    """write_table로 쓴 표를 다시 읽는다. 코드 컬럼은 문자열, date는 datetime64로 맞춘다."""
    parquet_path, csv_path = stem.with_suffix('.parquet'), stem.with_suffix('.csv')
    if prefer == 'parquet' and parquet_path.exists() and parquet_available():
        df = pd.read_parquet(parquet_path)
    elif csv_path.exists():
        header = pd.read_csv(csv_path, encoding='utf-8-sig', nrows=0).columns
        text_cols = [c for c in header if c.endswith('_code') or c in ('year_month',)]
        df = pd.read_csv(csv_path, encoding='utf-8-sig', dtype={c: str for c in text_cols})
    else:
        raise FileNotFoundError(f'{rel(csv_path)} 이 없습니다. 앞 단계 스크립트를 먼저 실행하세요.')
    if 'date' in df.columns:
        df['date'] = pd.to_datetime(df['date']).astype('datetime64[ns]')
    return df


def read_region_codes(path: Path = REGION_CODES_CSV) -> pd.DataFrame:
    df = pd.read_csv(path, encoding='utf-8-sig', dtype=str, keep_default_na=False)
    for col in ('is_general_gu', 'is_capital_area', 'is_adjacent_to_gimcheon'):
        df[col] = df[col].map({'true': True, 'false': False})
    return df


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')


def read_json(path: Path) -> dict:
    with open(path, encoding='utf-8') as f:
        return json.load(f)
