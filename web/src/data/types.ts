// web/public/data/population.json 의 형태 (scripts/build_web_data.py 가 만든다)

export type GenderCode = 'male' | 'female';

export interface RegionInfo {
  code: string; // 5자리 시군구 코드
  name: string; // 시군구 이름 (일반구는 "수원시 장안구")
  full: string; // 시도 + 시군구
  sido: string; // 시도 코드 2자리
  city: string; // 시 단위로 묶을 때의 코드
  cityName: string;
  zone: string; // 김천 기준 권역
  adjacent: boolean;
  capital: boolean;
}

export interface AgeInfo {
  code: string; // 원본 연령대 (00-09, 10-14 … 80+)
  age10: string;
  lifeStage: string;
  band: number | null; // 구간 폭(년), 80+ 는 null
}

export interface RawDataset {
  version: number;
  notice: string;
  measure: string; // 측정 항목 이름 (예: 3시간 이상 체류 생활인구)
  source: { file: string; sha256: string };
  stayRegion: { code: string; name: string };
  calendar: { start: string; end: string };
  capValue: number;
  dates: string[]; // 데이터가 있는 날짜 (YYYY-MM-DD)
  genders: { code: GenderCode; label: string }[];
  ages: AgeInfo[];
  lifeStages: { name: string; range: string }[];
  zones: string[];
  sidos: { code: string; name: string; short: string }[];
  regions: RegionInfo[];
  rows: {
    n: number;
    date: number[];
    region: number[];
    gender: number[];
    age: number[];
    pop100: number[]; // 체류인구수 × 100 (정수)
  };
}

export interface MonthInfo {
  key: string; // 2026-01
  year: number;
  month: number;
  label: string; // 1월
  firstDay: string;
  lastDay: string;
}

export interface Dataset {
  notice: string;
  measure: string;
  source: RawDataset['source'];
  stayRegion: RawDataset['stayRegion'];
  stayRegionIndex: number;
  stayName: string; // 체류지 시군구 이름 (예: 김천시)
  cap100: number;
  minPositive100: number; // 0이 아닌 체류인구수의 최솟값 (×100)
  calendar: string[]; // 달력상 모든 날짜
  calendarHasData: Uint8Array;
  dates: string[]; // 데이터가 있는 날짜
  dateCalendarIndex: Int32Array; // 데이터 날짜 → calendar 위치
  dateWeekday: Uint8Array; // 0 = 월요일
  dateMonth: Uint8Array; // months 위치
  rowsPerDate: Int32Array; // 날짜별 원본 행 수
  months: MonthInfo[];
  genders: RawDataset['genders'];
  ages: AgeInfo[];
  ageLifeStage: Uint8Array; // 연령대 → lifeStages 위치
  lifeStages: RawDataset['lifeStages'];
  zones: string[];
  sidos: RawDataset['sidos'];
  regions: RegionInfo[];
  regionZone: Uint8Array;
  regionIndex: Map<string, number>;
  rows: {
    n: number;
    date: Uint16Array;
    region: Uint16Array;
    gender: Uint8Array;
    age: Uint8Array;
    pop100: Int32Array;
  };
}
