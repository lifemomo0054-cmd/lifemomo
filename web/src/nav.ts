export interface NavItem {
  path: string;
  no: string;
  label: string;
  en: string;
  group: 'ANALYSIS' | 'SPACE' | 'LAB';
  summary: string;
  planned: string[];
  ready: boolean;
  needs?: string; // 준비에 필요한 것
}

export const NAV: NavItem[] = [
  {
    path: '/',
    no: '01',
    label: 'Overview',
    en: 'Overview',
    group: 'ANALYSIS',
    summary: '선택한 조건에서 체류인구의 규모·시간 패턴·구성·유입지역을 한 화면에 요약합니다.',
    planned: [],
    ready: true,
  },
  {
    path: '/time',
    no: '02',
    label: '시간 분석',
    en: 'Temporal',
    group: 'ANALYSIS',
    summary: '날짜·요일·월 단위로 체류인구가 언제 늘고 주는지 봅니다.',
    planned: [],
    ready: true,
  },
  {
    path: '/demographics',
    no: '03',
    label: '연령·성별',
    en: 'Demographics',
    group: 'ANALYSIS',
    summary: '누가 머무는지 — 성별과 연령대 구조를 봅니다.',
    planned: [],
    ready: true,
  },
  {
    path: '/origins',
    no: '04',
    label: '유입지역',
    en: 'Origins',
    group: 'ANALYSIS',
    summary: '어디에서 오는지 — 거주지 시군구와 권역별 유입을 봅니다.',
    planned: [],
    ready: true,
  },
  {
    path: '/map',
    no: '05',
    label: '생활인구 지도',
    en: 'Map',
    group: 'SPACE',
    summary: '거주지 시군구를 지도 위에 올려 유입 규모를 공간으로 봅니다.',
    planned: [],
    ready: true,
  },
  {
    path: '/compare',
    no: '06',
    label: '지역 비교',
    en: 'Compare',
    group: 'SPACE',
    summary: '두 거주지(또는 권역)를 나란히 놓고 규모·구성·추이를 비교합니다.',
    planned: ['두 지역 나란히 보기', '성·연령 구성 차이', '기간별 추이 비교'],
    ready: false,
  },
  {
    path: '/explore',
    no: '07',
    label: '데이터 탐색기',
    en: 'Explorer',
    group: 'LAB',
    summary: '필터가 적용된 행 단위 데이터를 표로 살펴보고 내려받습니다.',
    planned: [],
    ready: true,
  },
  {
    path: '/insight',
    no: '08',
    label: 'AI Insight',
    en: 'AI Insight',
    group: 'LAB',
    summary: '필터 결과를 문장으로 요약하고 질문에 답하는 기능을 붙일 자리입니다.',
    planned: ['현재 필터 결과 요약 문장', '두드러진 변화·이상값 설명', '데이터에 대한 질문하기'],
    ready: false,
    needs: 'AI 기능 연결 (아직 연결하지 않음)',
  },
];

export const NAV_GROUPS: { id: NavItem['group']; label: string }[] = [
  { id: 'ANALYSIS', label: 'Analysis' },
  { id: 'SPACE', label: 'Space' },
  { id: 'LAB', label: 'Lab' },
];

export function navItemFor(pathname: string): NavItem {
  return NAV.find((n) => n.path === pathname) ?? NAV[0];
}
