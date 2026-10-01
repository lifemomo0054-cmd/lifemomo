'use strict';

// 브라우저 쪽 코드. 인증키는 여기에 없다 — 상가정보 조회는 모두 로컬 서버의 /api/stores 를 거친다.

// 지도 위 점 색은 가장 흔한 세 대분류만 구분하고 나머지는 회색으로 묶는다.
// (색이 너무 많으면 서로 구분이 안 된다. 다른 업종은 목록에서 눌러서 따로 볼 수 있다.)
const LARGE_COLORS = [
  { match: /^음식/, label: '음식', color: '#2a78d6' },
  { match: /^소매/, label: '소매', color: '#eb6834' },
  { match: /^수리/, label: '수리·개인', color: '#1baf7a' },
];
const OTHER_COLOR = '#898781';
const SELECTED_OTHER_COLOR = '#3d3c39'; // 회색 업종만 골라 볼 때는 흐린 점과 구분되게 진하게
const POPUP_LIST_LIMIT = 30;

const LEVELS = {
  large: {
    key: (s) => s.largeCode || s.large,
    label: (s) => s.large,
    parent: () => '',
  },
  medium: {
    key: (s) => s.mediumCode || `${s.large}/${s.medium}`,
    label: (s) => s.medium,
    parent: (s) => s.large,
  },
  small: {
    key: (s) => s.smallCode || `${s.large}/${s.medium}/${s.small}`,
    label: (s) => s.small,
    parent: (s) => s.medium,
  },
  // 온누리 가맹점: 취급품목은 적힌 그대로 센다.
  item: {
    key: (s) => s.item || '(미기재)',
    label: (s) => s.item || '(미기재)',
    parent: () => '',
  },
  market: {
    key: (s) => s.marketId,
    label: (s) => s.market,
    parent: (s) => s.sido,
  },
};

// 데이터 종류마다 다른 것들. 반경·영역 찾기, 대상지, 목록, 저장 흐름은 같이 쓴다.
const SOURCES = {
  sbiz: {
    unit: '가게',
    unitObj: '가게를',
    countUnit: '개',
    filePrefix: '상가',
    radiusUrl: '/api/stores',
    areaUrl: '/api/stores/area',
    levels: [['large', '대분류'], ['medium', '중분류'], ['small', '소분류']],
    levelHint: '업종을 누르면 지도에 그 업종만 표시합니다.',
  },
  onnuri: {
    unit: '가맹점',
    unitObj: '가맹점을',
    countUnit: '곳',
    filePrefix: '온누리가맹점',
    radiusUrl: '/api/onnuri/stores',
    areaUrl: '/api/onnuri/stores/area',
    levels: [['item', '취급품목'], ['market', '시장·상점가']],
    levelHint: '품목이나 시장을 누르면 지도에 그 가맹점이 있는 시장만 표시합니다.',
  },
};
const MARKET_COLOR = '#2a78d6';
const LOC_SOURCE_LABEL = { manual: '직접 찍은 위치', standard: '전통시장 표준데이터', search: '주소 검색으로 찾음(확인 필요)' };
const src = () => SOURCES[state.source];

const state = {
  source: 'sbiz', // 'sbiz' = 상가(상권)정보 API, 'onnuri' = 온누리상품권 가맹점 파일
  generation: 0, // 데이터 종류를 바꾸면 늘어난다. 늦게 온 예전 응답은 버린다.
  mode: 'radius', // 'radius' = 반경(원)으로 찾기, 'area' = 직접 그린 대상지로 찾기
  center: null, // L.LatLng
  radius: 500,
  radiusData: null, // 마지막 반경 조회 결과
  data: null, // 지금 화면에 보이는 결과 (반경 조회 또는 고른 대상지)
  sites: [], // 직접 그린 대상지: { id, name, points: [[lat, lng], ...], data, loading, error }
  selectedSiteId: null,
  level: 'large',
  selectedKey: null,
  request: null, // 진행 중인 조회의 AbortController
};

let pinning = null; // 온누리: 지도에서 위치를 찍는 중인 시장 { market }
const $ = (id) => document.getElementById(id);
const numberFormat = new Intl.NumberFormat('ko-KR');

// ── 지도 ────────────────────────────────────────────────────────────────
// OpenStreetMap 타일은 키 없이 쓸 수 있다. 점이 많으므로 canvas로 그린다.
const map = L.map('map', { preferCanvas: true }).setView([37.5665, 126.978], 15);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자',
}).addTo(map);

const radiusLayer = L.layerGroup().addTo(map); // 반경 원 + 가운데 표시
const siteLayer = L.layerGroup(); // 직접 그린 대상지들
const marketBaseLayer = L.layerGroup(); // 온누리: 위치를 아는 모든 시장(흐린 점)
const regionLayer = L.layerGroup(); // 전국 상권 현황: 시도마다 원 하나
const storeLayer = L.layerGroup().addTo(map);
const drawLayer = L.layerGroup().addTo(map); // 그리는 중인 선

const legend = L.control({ position: 'bottomleft' });
legend.onAdd = () => L.DomUtil.create('div', 'legend');
legend.addTo(map);

function renderLegend() {
  const items =
    state.source === 'onnuri'
      ? [
          { label: '시장·상점가 (클수록 가맹점 많음)', color: MARKET_COLOR },
          { label: '위치만 아는 다른 시장', color: OTHER_COLOR },
        ]
      : [...LARGE_COLORS, { label: '그 밖의 업종', color: OTHER_COLOR }];
  legend.getContainer().replaceChildren(
    ...items.map(({ label, color }) => {
      const item = el('span', 'legend-item', label);
      item.prepend(swatch(color));
      return item;
    }),
  );
}

// 그리기·위치 찍기 중에는 점과 영역이 클릭을 가로채지 않게 한다.
const mapBusy = () => drawing.active || Boolean(pinning);

// 가게 팝업이 열린 상태에서 지도를 누르면 팝업만 닫고 새로 조회하지 않는다.
// (preclick 은 팝업이 닫히기 전에 오고, click 은 같은 흐름에서 바로 뒤따른다.)
let popupOpen = false;
let ignoreClick = false;
map.on('popupopen', () => (popupOpen = true));
map.on('popupclose', () => (popupOpen = false));
map.on('preclick', () => {
  if (!popupOpen) return;
  ignoreClick = true;
  setTimeout(() => (ignoreClick = false), 0);
});
map.on('click', (e) => {
  if (ignoreClick) return;
  if (pinning) {
    savePin(e.latlng);
    return;
  }
  if (drawing.active) {
    addDrawPoint(e.latlng);
    return;
  }
  $('candidates').hidden = true;
  if (state.mode === 'area') {
    setStatus('지금은 ‘영역 직접 그리기’예요. [＋ 새 대상지 그리기]를 누른 뒤 지도를 눌러 꼭짓점을 찍으세요.');
    return;
  }
  searchAt(e.latlng, { fit: 'auto' });
});

// ── 조회 ────────────────────────────────────────────────────────────────
async function searchAt(latlng, { fit }) {
  if (state.source === 'onnuri' && !onnuri.status?.loaded) {
    setStatus('먼저 위 [온누리 가맹점 파일]에서 CSV 파일을 올려 주세요.', 'error');
    return;
  }
  const generation = state.generation;
  state.center = L.latLng(latlng);
  state.data = null;
  state.radiusData = null;
  state.selectedKey = null;
  drawRadius(fit);
  render();

  state.request?.abort();
  const controller = new AbortController();
  state.request = controller;
  setStatus(`반경 ${formatRadius(state.radius)} 안의 ${src().unitObj} 불러오는 중…`, 'loading');

  const params = new URLSearchParams({
    lat: state.center.lat.toFixed(6),
    lng: state.center.lng.toFixed(6),
    radius: String(state.radius),
  });
  try {
    const data = await requestJson(`${src().radiusUrl}?${params}`, { signal: controller.signal });
    if (generation !== state.generation) return;
    prepareData(data);
    state.radiusData = data;
    if (state.mode === 'radius') state.data = data;
    setStatus('');
  } catch (err) {
    if (err.name === 'AbortError') return;
    setStatus(err.message, 'error');
  } finally {
    if (state.request === controller) state.request = null;
  }
  render();
}

function drawRadius(fit) {
  radiusLayer.clearLayers();
  storeLayer.clearLayers();
  if (!state.center) return;
  const circle = L.circle(state.center, {
    radius: state.radius,
    color: '#0b0b0b',
    weight: 1.5,
    dashArray: '6 5',
    fillColor: '#0b0b0b',
    fillOpacity: 0.04,
    interactive: false,
  }).addTo(radiusLayer);
  L.marker(state.center, {
    icon: L.divIcon({ className: 'center-pin', iconSize: [18, 18] }),
    interactive: false,
    keyboard: false,
  }).addTo(radiusLayer);
  restackLayers();

  const bounds = circle.getBounds();
  if (fit === 'always' || (fit !== 'keep' && !map.getBounds().contains(bounds))) {
    map.fitBounds(bounds, { padding: [24, 24] });
  }
}

function prepareData(data) {
  if (data.source !== 'onnuri') for (const s of data.stores) s.color = colorForLarge(s.large);
}

// 데이터가 바뀌었을 때(종류 바꿈, 시장 위치 저장 등) 지금 보고 있던 범위로 다시 찾는다.
function rerunQuery() {
  if (state.mode === 'radius') {
    if (state.center) searchAt(state.center, { fit: 'keep' });
    return;
  }
  for (const site of state.sites) {
    site.data = null;
    site.error = '';
  }
  state.data = null;
  render();
  const site = currentSite();
  if (site) loadSite(site);
  renderSiteList();
}

// 그리는 순서(아래→위): 내 SHP → 대상지 → 반경 원 → 가게 점. 점이 늘 맨 위에 있어야 누를 수 있다.
function restackLayers() {
  marketBaseLayer.eachLayer((l) => l.bringToBack && l.bringToBack());
  radiusLayer.eachLayer((l) => l.bringToBack && l.bringToBack());
  siteLayer.eachLayer((l) => l.bringToBack && l.bringToBack());
  for (const overlay of overlays) overlay.layer?.bringToBack();
  regionLayer.eachLayer((l) => l.bringToBack && l.bringToBack()); // 시도 원은 맨 아래
}

async function searchAddress(query) {
  $('candidates').hidden = true;
  setStatus('주소를 찾는 중…', 'loading');
  let results;
  try {
    results = await requestJson(`/api/geocode?${new URLSearchParams({ q: query })}`);
  } catch (err) {
    setStatus(err.message, 'error');
    return;
  }
  if (!results.length) {
    setStatus('주소를 찾지 못했어요. 도로명·지번 주소나 역·건물 이름으로 다시 검색해 보세요.', 'error');
    return;
  }
  showCandidates(results, 0);
  goToPlace(results[0]);
}

// 반경 모드면 그 자리에서 찾고, 대상지 모드면 지도만 옮긴다(그 근처에 그리도록).
function goToPlace(place) {
  if (state.mode === 'area') {
    map.setView([place.lat, place.lng], 17);
    setStatus('이 근처에 대상지를 그려 보세요. [＋ 새 대상지 그리기]를 누르면 시작합니다.');
    return;
  }
  searchAt(place, { fit: 'always' });
}

function showCandidates(results, activeIndex) {
  const list = $('candidates');
  list.replaceChildren();
  list.hidden = results.length < 2;
  results.forEach((r, i) => {
    const button = el('button', 'candidate', r.label);
    button.type = 'button';
    button.setAttribute('aria-current', String(i === activeIndex));
    button.addEventListener('click', () => {
      showCandidates(results, i);
      goToPlace(r);
    });
    const li = el('li');
    li.append(button);
    list.append(li);
  });
}

// body를 주면 JSON으로 POST 한다.
async function requestJson(url, { signal, body } = {}) {
  let res;
  try {
    res = await fetch(
      url,
      body === undefined
        ? { signal }
        : { signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(
      '지도 프로그램(까만 창)이 꺼져 있어요. 폴더의 start-windows를 더블클릭해서(또는 npm start로) 다시 켠 뒤 이 페이지를 새로고침하세요.',
    );
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(payload?.error || `서버 응답 오류 (HTTP ${res.status})`);
  return payload;
}

// ── 그리기 ──────────────────────────────────────────────────────────────
function render() {
  renderStores();
  renderStats();
  drawRegionLayer(); // 그리기·위치 찍기 중에는 시도 원도 클릭을 가로채지 않게 다시 그린다
}

function renderStores() {
  if (state.source === 'onnuri') {
    renderMarkets();
    return;
  }
  storeLayer.clearLayers();
  if (!state.data) return;
  const levelKey = LEVELS[state.level].key;
  const selected = state.selectedKey;
  const isActive = (s) => !selected || levelKey(s) === selected;

  // 같은 건물(같은 좌표)에 있는 가게를 묶어서 팝업에 함께 보여준다.
  const byPoint = new Map();
  for (const s of state.data.stores) {
    if (!isActive(s)) continue;
    const k = `${s.lat},${s.lng}`;
    if (!byPoint.has(k)) byPoint.set(k, []);
    byPoint.get(k).push(s);
  }

  // 흐린 점 → 회색 점 → 색 있는 점 순서로 그려서 색 있는 점이 위에 오게 한다.
  const drawRank = (s) => (isActive(s) ? 2 : 0) + (s.color === OTHER_COLOR ? 0 : 1);
  const stores = [...state.data.stores].sort((a, b) => drawRank(a) - drawRank(b));

  for (const s of stores) {
    if (!isActive(s)) {
      storeLayer.addLayer(
        L.circleMarker([s.lat, s.lng], { radius: 2.5, stroke: false, fillColor: OTHER_COLOR, fillOpacity: 0.3, interactive: false }),
      );
      continue;
    }
    const here = byPoint.get(`${s.lat},${s.lng}`);
    const marker = L.circleMarker([s.lat, s.lng], {
      radius: selected ? 6 : 5,
      color: '#ffffff',
      weight: 1.5,
      fillColor: selected && s.color === OTHER_COLOR ? SELECTED_OTHER_COLOR : s.color,
      fillOpacity: 0.95,
      bubblingMouseEvents: false,
      interactive: !mapBusy(), // 그리는 중에는 점을 눌러도 꼭짓점이 찍히게
    });
    // Leaflet은 문자열을 HTML로 넣으므로, 가게 이름은 항상 텍스트 노드로 넘긴다.
    const tooltip = here.length > 1 ? `${s.name} 외 ${here.length - 1}곳` : s.name;
    marker.bindTooltip(() => el('span', null, tooltip), { direction: 'top', offset: [0, -6] });
    marker.bindPopup(() => popupContent(s, here), { maxWidth: 300 });
    storeLayer.addLayer(marker);
  }
}

function popupContent(store, here) {
  const root = el('div', 'popup');
  root.append(el('div', 'popup-address', store.address || '주소 정보 없음'));
  if (here.length > 1) root.append(el('div', 'popup-count', `이 위치의 가게 ${here.length}곳`));

  const ordered = [store, ...here.filter((s) => s !== store)];
  const list = el('ul', 'popup-list');
  for (const s of ordered.slice(0, POPUP_LIST_LIMIT)) {
    const item = el('li');
    const name = el('strong', null, s.branch ? `${s.name} ${s.branch}` : s.name);
    name.prepend(swatch(s.color));
    const meta = [s.medium, s.small, formatFloor(s.floor)].filter(Boolean).join(' · ');
    item.append(name, el('span', 'popup-meta', meta));
    list.append(item);
  }
  root.append(list);
  if (ordered.length > POPUP_LIST_LIMIT) {
    root.append(el('div', 'popup-more', `외 ${ordered.length - POPUP_LIST_LIMIT}곳`));
  }
  return root;
}

function renderStats() {
  const data = state.data;
  $('result').hidden = !data;
  if (!data) return;
  renderRegionNote();

  const stores = data.stores;
  const onnuriData = data.source === 'onnuri';
  $('total-count').textContent = numberFormat.format(stores.length);
  $('total-unit').textContent = src().countUnit;
  const scope = scopeInfo();
  $('summary-meta').textContent = (
    onnuriData
      ? [scope.meta, `시장·상점가 ${numberFormat.format(data.markets.length)}곳`, formatDate(data.dataDate)]
      : [scope.meta, formatYearMonth(data.stdrYm)]
  )
    .filter(Boolean)
    .join(' · ');

  const truncated = $('truncated');
  truncated.hidden = !data.truncated;
  truncated.textContent = !data.truncated
    ? ''
    : onnuriData
      ? `가맹점이 너무 많아서 ${numberFormat.format(stores.length)}곳까지만 불러왔어요. 범위를 줄이면 전부 볼 수 있어요.`
      : data.kind === 'area'
      ? `이 대상지는 가게가 많아서 일부(${numberFormat.format(stores.length)}개)만 불러왔어요. ` +
        '업종별 개수도 불러온 가게 기준입니다. 대상지를 작게 나눠 그리면 전부 볼 수 있어요.'
      : `이 반경에는 가게가 ${numberFormat.format(data.totalCount)}개 있지만 ${numberFormat.format(stores.length)}개만 불러왔어요. ` +
        '업종별 개수도 불러온 가게 기준입니다. 반경을 줄이면 전부 볼 수 있어요.';

  const unlocated = onnuriData && onnuri.status ? onnuri.status.markets - onnuri.status.located : 0;
  $('result-note').hidden = !unlocated;
  $('result-note').textContent = unlocated
    ? `위치를 모르는 시장·상점가 ${numberFormat.format(unlocated)}곳(가맹점 ${numberFormat.format(onnuri.status.unlocatedStores)}곳)은 ` +
      '지도에 없어서 여기에 세지 않았어요. 위 [온누리 가맹점 파일]에서 위치를 채우면 함께 셀 수 있어요.'
    : '';

  $('level-tabs').replaceChildren(
    ...src().levels.map(([id, label]) => {
      const tab = el('button', null, label);
      tab.type = 'button';
      tab.setAttribute('aria-pressed', String(id === state.level));
      tab.addEventListener('click', () => {
        state.level = id;
        state.selectedKey = null;
        render();
      });
      return tab;
    }),
  );
  $('level-hint').textContent = src().levelHint;

  const level = LEVELS[state.level];
  const groups = new Map();
  for (const s of stores) {
    const key = level.key(s);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: level.label(s) || '미분류', parent: level.parent(s), color: onnuriData ? MARKET_COLOR : s.color, count: 0 };
      groups.set(key, group);
    }
    group.count++;
  }
  const rows = [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko'));

  const selectedRow = rows.find((r) => r.key === state.selectedKey);
  $('filter-chip').hidden = !selectedRow;
  $('filter-label').textContent = selectedRow ? `‘${selectedRow.label}’ ${numberFormat.format(selectedRow.count)}개만 보는 중` : '';

  $('export-xlsx').disabled = stores.length === 0;
  $('export-xlsx').textContent = `엑셀로 저장 (${numberFormat.format(stores.length)}${src().countUnit})`;
  $('export-shp').disabled = stores.length === 0;
  if (onnuriData) {
    const marketCount = numberFormat.format(new Set(visibleStores().map((s) => s.marketId)).size);
    $('export-shp').textContent = selectedRow ? `‘${selectedRow.label}’ 시장 SHP로 저장 (${marketCount}곳)` : `시장 위치 SHP로 저장 (${marketCount}곳)`;
  } else {
    const exportCount = numberFormat.format(visibleStores().length);
    $('export-shp').textContent = selectedRow
      ? `‘${selectedRow.label}’만 SHP로 저장 (${exportCount}개)`
      : `SHP로 저장 (${exportCount}개)`;
  }

  const list = $('category-list');
  if (!rows.length) {
    list.replaceChildren(
      el('li', 'empty', onnuriData ? `${scope.where} 안에는 위치를 아는 시장·상점가가 없어요.` : `${scope.where} 안에는 등록된 가게가 없어요.`),
    );
    return;
  }
  const max = rows[0].count;
  list.replaceChildren(
    ...rows.map((row) => {
      const button = el('button', 'category');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(row.key === state.selectedKey));
      button.addEventListener('click', () => {
        state.selectedKey = state.selectedKey === row.key ? null : row.key;
        render();
      });

      const name = el('span', 'category-name', row.label);
      if (row.parent) name.append(el('span', 'category-parent', row.parent));
      const count = el('span', 'category-count', numberFormat.format(row.count));
      count.append(el('span', 'category-share', formatShare(row.count, stores.length)));
      const bar = el('span', 'category-bar');
      const fill = el('span');
      fill.style.width = `${(row.count / max) * 100}%`;
      fill.style.background = row.color;
      bar.append(fill);

      button.append(name, count, bar);
      const li = el('li');
      li.append(button);
      return li;
    }),
  );
}

function setStatus(message, kind = '') {
  const status = $('status');
  status.textContent = message;
  status.className = `status ${kind}`;
  status.hidden = !message;
}

// ── 작은 도우미 ─────────────────────────────────────────────────────────
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function swatch(color) {
  const dot = el('span', 'swatch');
  dot.style.background = color;
  return dot;
}

function colorForLarge(name) {
  return LARGE_COLORS.find((c) => c.match.test(name || ''))?.color || OTHER_COLOR;
}

function formatRadius(m) {
  return m >= 1000 ? `${m / 1000}km` : `${m}m`;
}

// 1평 = 3.3058㎡
function formatArea(m2) {
  if (!Number.isFinite(m2)) return '-';
  if (m2 >= 1_000_000) return `${(m2 / 1_000_000).toFixed(2)}㎢`;
  return `${numberFormat.format(Math.round(m2))}㎡ (약 ${numberFormat.format(Math.round(m2 / 3.3058))}평)`;
}

function formatShare(count, total) {
  const pct = (count / total) * 100;
  return pct < 1 ? '1% 미만' : `${Math.round(pct)}%`;
}

function formatDate(ymd) {
  const m = String(ymd || '').match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일 기준` : '';
}

function formatDuration(seconds) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}초`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}분`;
  return `${Math.floor(seconds / 3600)}시간 ${Math.ceil((seconds % 3600) / 60)}분`;
}

function countBy(list, keyOf) {
  const counts = new Map();
  for (const item of list) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function formatYearMonth(ym) {
  const m = String(ym || '').match(/^(\d{4})(\d{2})/);
  return m ? `${m[1]}년 ${Number(m[2])}월 기준` : '';
}

function formatFloor(floor) {
  const f = String(floor || '').trim();
  if (!f) return '';
  if (/^\d+$/.test(f)) return `${f}층`;
  const basement = f.match(/^(?:B|지하)\s*(\d+)$/i);
  return basement ? `지하 ${basement[1]}층` : f;
}

// ── SHP로 저장 ──────────────────────────────────────────────────────────
// SHP 속성 이름은 영문 10자까지라서 짧은 이름을 쓴다. (README에 뜻을 적어 두었다.)
const SHP_FIELDS = [
  { name: 'BIZES_ID', type: 'C', length: 24, from: (s) => s.id },
  { name: 'NAME', type: 'C', length: 150, from: (s) => s.name },
  { name: 'BRANCH', type: 'C', length: 60, from: (s) => s.branch },
  { name: 'LCLS_CD', type: 'C', length: 10, from: (s) => s.largeCode },
  { name: 'LCLS_NM', type: 'C', length: 60, from: (s) => s.large },
  { name: 'MCLS_CD', type: 'C', length: 10, from: (s) => s.mediumCode },
  { name: 'MCLS_NM', type: 'C', length: 90, from: (s) => s.medium },
  { name: 'SCLS_CD', type: 'C', length: 10, from: (s) => s.smallCode },
  { name: 'SCLS_NM', type: 'C', length: 120, from: (s) => s.small },
  { name: 'SIDO', type: 'C', length: 40, from: (s) => s.sido },
  { name: 'SIGUNGU', type: 'C', length: 40, from: (s) => s.sigungu },
  { name: 'ADONG', type: 'C', length: 40, from: (s) => s.adong },
  { name: 'LDONG', type: 'C', length: 40, from: (s) => s.ldong },
  { name: 'ROAD_ADDR', type: 'C', length: 254, from: (s) => s.roadAddress },
  { name: 'JIBUN_ADDR', type: 'C', length: 254, from: (s) => s.jibunAddress },
  { name: 'BLDG_NM', type: 'C', length: 150, from: (s) => s.building },
  { name: 'FLOOR', type: 'C', length: 20, from: (s) => s.floor },
  { name: 'LON', type: 'N', length: 14, decimals: 8, from: (s) => s.lng },
  { name: 'LAT', type: 'N', length: 13, decimals: 8, from: (s) => s.lat },
];

// 지금 지도에 진하게 보이는 가게(업종을 골랐으면 그 업종만)
function visibleStores() {
  if (!state.data) return [];
  const levelKey = LEVELS[state.level].key;
  return state.selectedKey ? state.data.stores.filter((s) => levelKey(s) === state.selectedKey) : state.data.stores;
}

// 온누리: 가게 좌표가 없으므로 시장·상점가 위치를 점으로 저장한다.
const MARKET_SHP_FIELDS = [
  { name: 'MRKT_NM', type: 'C', length: 150, from: (m) => m.name },
  { name: 'SIDO', type: 'C', length: 30, from: (m) => m.sido },
  { name: 'STORE_CNT', type: 'N', length: 10, from: (m) => m.shown },
  { name: 'ALL_CNT', type: 'N', length: 10, from: (m) => m.count },
  { name: 'LOC_SRC', type: 'C', length: 60, from: (m) => LOC_SOURCE_LABEL[m.locSource] || '' },
  { name: 'LOC_NOTE', type: 'C', length: 254, from: (m) => m.locLabel },
  { name: 'LON', type: 'N', length: 14, decimals: 8, from: (m) => m.lng },
  { name: 'LAT', type: 'N', length: 13, decimals: 8, from: (m) => m.lat },
];

function shpPoints() {
  if (state.source === 'onnuri') {
    const counts = countBy(visibleStores(), (s) => s.marketId);
    const markets = state.data.markets.filter((m) => counts.get(m.id)).map((m) => ({ ...m, shown: counts.get(m.id) }));
    return { base: 'markets', fields: MARKET_SHP_FIELDS, items: markets, x: (m) => m.lng, y: (m) => m.lat };
  }
  return { base: 'stores', fields: SHP_FIELDS, items: visibleStores(), x: (s) => s.lng, y: (s) => s.lat };
}

async function exportShp() {
  const { base, fields, items, x, y } = shpPoints();
  if (!items.length) return;
  const button = $('export-shp');
  button.disabled = true;
  try {
    const set = Shapefile.writePointShapefile(
      items.map((item) => ({
        x: x(item),
        y: y(item),
        attributes: Object.fromEntries(fields.map((f) => [f.name, f.from(item)])),
      })),
      fields,
    );
    const text = new TextEncoder();
    const zipBytes = await Shapefile.zip([
      { name: `${base}.shp`, data: set.shp },
      { name: `${base}.shx`, data: set.shx },
      { name: `${base}.dbf`, data: set.dbf },
      { name: `${base}.prj`, data: text.encode(Shapefile.WGS84_PRJ) },
      { name: `${base}.cpg`, data: text.encode('UTF-8') },
    ]);
    download(new Blob([zipBytes], { type: 'application/zip' }), exportFileName());
  } catch (err) {
    setStatus(`SHP 파일을 만들지 못했어요: ${err.message}`, 'error');
  } finally {
    button.disabled = false;
  }
}

function exportFileName() {
  const selected = state.selectedKey && state.data.stores.find((s) => LEVELS[state.level].key(s) === state.selectedKey);
  return fileName(selected ? LEVELS[state.level].label(selected) || '미분류' : '전체', 'zip');
}

// 예: 상가_김천시 자산동_대분류별_반경300m_20260923.xlsx, 상가_역앞 상권_대분류별_20260923.xlsx
function fileName(what, extension) {
  return datedFileName([src().filePrefix, ...scopeInfo().fileParts(what)], extension);
}

function datedFileName(parts, extension) {
  const d = new Date();
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${[...parts, day].filter(Boolean).join('_')}.${extension}`.replace(/[\\/:*?"<>|]/g, '·');
}

// 지금 결과가 반경 조회인지 대상지인지에 따라 달라지는 글과 파일 이름 조각
function scopeInfo() {
  const data = state.data;
  const site = currentSite();
  if (data && data.kind === 'area' && site) {
    return {
      meta: `${site.name} · 면적 ${formatArea(data.areaM2)}`,
      where: '이 대상지',
      fileParts: (what) => [site.name, what],
      summary: [['대상지', site.name], ['면적', formatArea(data.areaM2)], ['꼭짓점', `${site.points.length}개`]],
    };
  }
  return {
    meta: data ? `반경 ${formatRadius(data.radius)}` : '',
    where: '이 반경',
    fileParts: (what) => [placeName(), what, data ? `반경${formatRadius(data.radius)}` : ''],
    summary: data
      ? [
          ['위치', [placeName(), `위도 ${data.center.lat}, 경도 ${data.center.lng}`].filter(Boolean).join(' · ')],
          ['반경', formatRadius(data.radius)],
        ]
      : [],
  };
}

// 불러온 가게들이 가장 많이 속한 행정동 (예: "김천시 자산동")
function placeName() {
  if (state.data && state.data.source === 'onnuri') {
    const markets = [...state.data.markets].sort((a, b) => b.count - a.count);
    if (!markets.length) return '';
    return markets.length > 1 ? `${markets[0].name} 외 ${markets.length - 1}곳` : markets[0].name;
  }
  const counts = new Map();
  for (const s of state.data.stores) {
    const place = [s.sigungu, s.adong].filter(Boolean).join(' ');
    if (place) counts.set(place, (counts.get(place) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

// ── 엑셀로 저장 ─────────────────────────────────────────────────────────
// 요약(대분류별 개수) + 전체 목록 + 대분류마다 시트 하나.
async function exportExcel() {
  const data = state.data;
  if (!data || !data.stores.length) return;
  const button = $('export-xlsx');
  button.disabled = true;
  try {
    if (data.source === 'onnuri') {
      await exportOnnuriExcel(data);
      return;
    }
    const groups = new Map();
    for (const s of data.stores) {
      const label = s.large || '미분류';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(s);
    }
    const byName = (a, b) => a.name.localeCompare(b.name, 'ko') || a.branch.localeCompare(b.branch, 'ko');
    const sorted = [...groups]
      .map(([label, stores]) => ({ label, stores: stores.sort(byName) }))
      .sort((a, b) => b.stores.length - a.stores.length || a.label.localeCompare(b.label, 'ko'));

    const header = ['상호명', '지점명', '중분류', '소분류', '도로명주소', '지번주소', '층'];
    const widths = [28, 12, 16, 20, 40, 34, 8];
    const row = (s) => [s.name, s.branch, s.medium, s.small, s.roadAddress || s.address, s.jibunAddress, formatFloor(s.floor)];
    const total = data.stores.length;
    const summaryRows = [
      ['항목', '내용'],
      ...scopeInfo().summary,
      ['데이터 기준', formatYearMonth(data.stdrYm) || '-'],
      ['가게 수', total],
    ];
    if (data.truncated) summaryRows.push(['주의', `가게가 많아 ${total}개만 불러왔습니다. 범위를 줄이면 전부 받을 수 있습니다.`]);
    summaryRows.push([], { bold: true, cells: ['대분류', '가게 수', '비율'] });
    for (const g of sorted) summaryRows.push([g.label, g.stores.length, { value: g.stores.length / total, style: 'percent' }]);

    const bytes = await Xlsx.build([
      { name: '요약', rows: summaryRows, widths: [14, 44, 10], header: true },
      {
        name: '전체',
        rows: [['대분류', ...header], ...sorted.flatMap((g) => g.stores.map((s) => [g.label, ...row(s)]))],
        widths: [14, ...widths],
        header: true,
        autoFilter: true,
      },
      ...sorted.map((g) => ({ name: g.label, rows: [header, ...g.stores.map(row)], widths, header: true, autoFilter: true })),
    ]);
    download(
      new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      fileName('대분류별', 'xlsx'),
    );
  } catch (err) {
    setStatus(`엑셀 파일을 만들지 못했어요: ${err.message}`, 'error');
  } finally {
    button.disabled = false;
  }
}

// 온누리: 요약 + 취급품목별(적힌 그대로) + 시장별 + 전체 가맹점 목록
async function exportOnnuriExcel(data) {
  const stores = data.stores;
  const total = stores.length;
  const itemCounts = [...countBy(stores, (s) => s.item || '(미기재)')].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  const marketCounts = countBy(stores, (s) => s.marketId);
  const markets = [...data.markets].sort((a, b) => (marketCounts.get(b.id) || 0) - (marketCounts.get(a.id) || 0));
  const st = onnuri.status || {};
  const unlocated = st.markets ? st.markets - st.located : 0;

  const summary = [
    ['항목', '내용'],
    ...scopeInfo().summary,
    ['데이터 파일', st.fileName || '-'],
    ['데이터 기준', formatDate(data.dataDate) || '-'],
    ['시장·상점가 수', data.markets.length],
    ['가맹점 수', total],
    ['디지털형 가맹', stores.filter((s) => s.digital).length],
  ];
  if (unlocated) {
    summary.push(['주의', `위치를 모르는 시장·상점가 ${unlocated}곳(가맹점 ${st.unlocatedStores}곳)은 지도에 없어 포함되지 않았습니다.`]);
  }
  if (data.truncated) summary.push(['주의', `가맹점이 많아 ${total}곳까지만 담았습니다. 범위를 줄이면 전부 받을 수 있습니다.`]);

  const byMarketThenName = (a, b) =>
    (marketCounts.get(b.marketId) || 0) - (marketCounts.get(a.marketId) || 0) ||
    a.market.localeCompare(b.market, 'ko') ||
    a.name.localeCompare(b.name, 'ko');
  const yn = (v) => (v ? 'Y' : 'N');

  const bytes = await Xlsx.build([
    { name: '요약', rows: summary, widths: [16, 64], header: true },
    {
      name: '취급품목별',
      rows: [['취급품목', '가맹점 수', '비율'], ...itemCounts.map(([item, n]) => [item, n, { value: n / total, style: 'percent' }])],
      widths: [32, 10, 8],
      header: true,
      autoFilter: true,
    },
    {
      name: '시장별',
      rows: [
        ['시도', '시장·상점가', '가맹점 수', '위치 출처'],
        ...markets.map((m) => [m.sido, m.name, marketCounts.get(m.id) || 0, LOC_SOURCE_LABEL[m.locSource] || '']),
      ],
      widths: [8, 34, 10, 26],
      header: true,
      autoFilter: true,
    },
    {
      name: '전체',
      rows: [
        ['가맹점명', '소속 시장·상점가', '소재지', '취급품목', '지류형', '디지털형', '가맹 등록년도'],
        ...[...stores].sort(byMarketThenName).map((s) => [s.name, s.market, s.sido, s.item, yn(s.paper), yn(s.digital), s.year]),
      ],
      widths: [28, 32, 8, 26, 8, 8, 12],
      header: true,
      autoFilter: true,
    },
  ]);
  download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName('품목별', 'xlsx'));
}

function download(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ── 내 SHP 파일 겹쳐 보기 ───────────────────────────────────────────────
const OVERLAY_COLOR = '#4a3aa7';
const OVERLAY_STYLE = { color: OVERLAY_COLOR, weight: 2, opacity: 0.9, fillColor: OVERLAY_COLOR, fillOpacity: 0.08 };
const OVERLAY_POINT_STYLE = { radius: 5, color: '#ffffff', weight: 1.5, fillColor: OVERLAY_COLOR, fillOpacity: 0.95 };
const KOREA_BOUNDS = L.latLngBounds([32, 123], [39.8, 132.5]);
const MAX_IMPORT_BYTES = 300 * 1024 * 1024;
const TOOLTIP_FIELD_LIMIT = 8;
const SHP_PART = /\.(shp|shx|dbf|prj|cpg)$/i;

const overlays = [];
let overlaySeq = 0;

async function importFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > MAX_IMPORT_BYTES) {
    setOverlayStatus('파일이 너무 커요(300MB 넘음). 필요한 지역만 잘라서 다시 올려 주세요.', 'error');
    return;
  }
  setOverlayStatus('SHP 파일을 읽는 중…', 'loading');
  try {
    const entries = [];
    for (const file of files) {
      const data = new Uint8Array(await file.arrayBuffer());
      if (/\.zip$/i.test(file.name)) entries.push(...(await Shapefile.unzip(data, (name) => SHP_PART.test(name))));
      else if (SHP_PART.test(file.name)) entries.push({ name: file.name, data });
    }
    const sets = Shapefile.groupShapefiles(entries);
    if (!sets.length) {
      throw new Error('.shp 파일을 찾지 못했어요. SHP가 든 ZIP 파일이나, .shp·.dbf·.prj 파일을 함께 골라 주세요.');
    }
    const missingDbf = sets.filter((set) => !set.dbf).map((set) => set.name);
    sets.forEach((set, i) => addOverlay(Shapefile.readShapefile(set), i === sets.length - 1));
    setOverlayStatus(missingDbf.length ? `.dbf 파일이 없어서 속성은 빼고 모양만 보여 줘요: ${missingDbf.join(', ')}` : '');
  } catch (err) {
    setOverlayStatus(err.message, 'error');
  }
}

function addOverlay(data, fit) {
  const detected = Crs.detectCrs(data.prj, rawBounds(data.features));
  const overlay = { id: ++overlaySeq, data, detected, crs: detected, layer: null };
  overlays.push(overlay);
  drawOverlay(overlay, fit);
}

function drawOverlay(overlay, fit) {
  overlay.layer?.remove();
  overlay.layer = null;
  overlay.error = '';
  let toLatLng;
  try {
    toLatLng = latLngConverter(overlay.crs.def);
  } catch {
    overlay.error = '이 좌표계로는 바꿀 수 없어요. 다른 좌표계를 골라 보세요.';
    renderOverlayList();
    return;
  }

  const group = L.featureGroup();
  for (const feature of overlay.data.features) {
    const layer = overlayFeatureLayer(feature.geometry, toLatLng);
    if (!layer) continue;
    if (Object.keys(feature.properties).length) {
      layer.bindTooltip(() => attributeTable(feature.properties), { sticky: true, className: 'overlay-tooltip' });
    }
    group.addLayer(layer);
  }
  group.addTo(map);
  overlay.layer = group;
  restackLayers(); // 가게 점·대상지보다 아래에 그려서 그것들을 누를 수 있게 한다.

  const bounds = group.getBounds();
  overlay.outside = !bounds.isValid() || !KOREA_BOUNDS.intersects(bounds);
  if (fit && bounds.isValid() && !overlay.outside) map.fitBounds(bounds, { padding: [24, 24] });
  renderOverlayList();
}

function latLngConverter(def) {
  const project = def === Crs.byCode('EPSG:4326').def ? (xy) => xy : proj4(def, 'EPSG:4326').forward;
  return (xy) => {
    const [lng, lat] = project(xy);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 ? [lat, lng] : null;
  };
}

function overlayFeatureLayer(geometry, toLatLng) {
  const line = (coords) => coords.map(toLatLng).filter(Boolean);
  switch (geometry.type) {
    case 'Point': {
      const at = toLatLng(geometry.coordinates);
      return at && L.circleMarker(at, OVERLAY_POINT_STYLE);
    }
    case 'MultiPoint': {
      const points = line(geometry.coordinates).map((at) => L.circleMarker(at, OVERLAY_POINT_STYLE));
      return points.length ? L.featureGroup(points) : null;
    }
    case 'LineString':
    case 'MultiLineString': {
      const parts = (geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates).map(line).filter((p) => p.length > 1);
      return parts.length ? L.polyline(parts, { ...OVERLAY_STYLE, fill: false }) : null;
    }
    case 'Polygon': {
      const rings = geometry.coordinates.map(line).filter((r) => r.length > 2);
      return rings.length ? L.polygon(rings, OVERLAY_STYLE) : null;
    }
    default:
      return null;
  }
}

function rawBounds(features) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
    } else {
      c.forEach(visit);
    }
  };
  for (const f of features) visit(f.geometry.coordinates);
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : [0, 0, 0, 0];
}

function attributeTable(properties) {
  const table = el('table', 'attr-table');
  const entries = Object.entries(properties).filter(([, v]) => v !== '' && v != null);
  for (const [key, value] of entries.slice(0, TOOLTIP_FIELD_LIMIT)) {
    const row = el('tr');
    row.append(el('th', null, key), el('td', null, String(value)));
    table.append(row);
  }
  if (entries.length > TOOLTIP_FIELD_LIMIT) {
    const row = el('tr');
    const more = el('td', 'attr-more', `외 ${entries.length - TOOLTIP_FIELD_LIMIT}개 항목`);
    more.colSpan = 2;
    row.append(more);
    table.append(row);
  }
  return table;
}

function renderOverlayList() {
  const list = $('overlay-list');
  list.replaceChildren(
    ...overlays.map((overlay) => {
      const item = el('li', 'overlay-item');

      const head = el('div', 'overlay-head');
      const name = el('strong', null, overlay.data.name);
      name.prepend(swatch(OVERLAY_COLOR));
      head.append(name, el('span', 'overlay-count', describeShapes(overlay.data.features)));

      const crsLabel = el('label', 'overlay-crs');
      crsLabel.append(el('span', null, '좌표계'));
      const select = el('select');
      const options = overlay.detected.code === 'custom' ? [overlay.detected, ...Crs.KNOWN] : Crs.KNOWN;
      for (const crs of options) {
        const option = el('option', null, crs.code === overlay.detected.code ? overlay.detected.label : crs.label);
        option.value = crs.code;
        option.selected = crs.code === overlay.crs.code;
        select.append(option);
      }
      select.addEventListener('change', () => {
        overlay.crs = select.value === overlay.detected.code ? overlay.detected : Crs.byCode(select.value);
        drawOverlay(overlay, true);
      });
      crsLabel.append(select);
      item.append(head, crsLabel);

      const warning = overlay.error
        || (overlay.crs.source === 'guess' ? '.prj 파일이 없어서 좌표 범위로 좌표계를 짐작했어요. 위치가 이상하면 좌표계를 바꿔 보세요.' : '')
        || (overlay.outside ? '위치가 한국 밖으로 나와요. 좌표계를 바꿔 보세요.' : '');
      if (warning) item.append(el('p', 'overlay-warn', warning));

      const actions = el('div', 'overlay-actions');
      const zoom = el('button', null, '이 위치로 이동');
      zoom.type = 'button';
      zoom.disabled = !overlay.layer || !overlay.layer.getBounds().isValid();
      zoom.addEventListener('click', () => map.fitBounds(overlay.layer.getBounds(), { padding: [24, 24] }));
      const remove = el('button', null, '지우기');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        overlay.layer?.remove();
        overlays.splice(overlays.indexOf(overlay), 1);
        renderOverlayList();
      });
      actions.append(zoom, remove);
      item.append(actions);
      return item;
    }),
  );
}

function describeShapes(features) {
  const kinds = { Point: '점', MultiPoint: '점', LineString: '선', MultiLineString: '선', Polygon: '면' };
  const counts = {};
  for (const f of features) {
    const kind = kinds[f.geometry.type] || '기타';
    counts[kind] = (counts[kind] || 0) + 1;
  }
  const parts = Object.entries(counts).map(([kind, n]) => `${kind} ${numberFormat.format(n)}개`);
  return parts.length ? parts.join(' · ') : '도형 없음';
}

function setOverlayStatus(message, kind = '') {
  const status = $('overlay-status');
  status.textContent = message;
  status.className = `status ${kind}`;
  status.hidden = !message;
}

// ── 온누리 가맹점: 시장·상점가 점 ──────────────────────────────────────
// 가맹점 파일에는 가게 위치가 없어서, 소속 시장·상점가마다 점 하나로 보여 준다(점이 클수록 가맹점이 많다).
const marketRadius = (n) => Math.min(22, 5 + Math.sqrt(n) * 0.9);

function renderMarkets() {
  storeLayer.clearLayers();
  renderMarketBase();
  const data = state.data;
  if (!data || data.source !== 'onnuri') return;
  const levelKey = LEVELS[state.level].key;
  const selected = state.selectedKey;
  const shown = countBy(selected ? data.stores.filter((s) => levelKey(s) === selected) : data.stores, (s) => s.marketId);
  // 작은 점을 먼저 그려서 큰 점 아래에 깔리게
  for (const m of [...data.markets].sort((a, b) => (shown.get(a.id) || 0) - (shown.get(b.id) || 0))) {
    const n = shown.get(m.id) || 0;
    if (!n) {
      storeLayer.addLayer(
        L.circleMarker([m.lat, m.lng], { radius: 3, stroke: false, fillColor: OTHER_COLOR, fillOpacity: 0.35, interactive: false }),
      );
      continue;
    }
    const marker = L.circleMarker([m.lat, m.lng], {
      radius: marketRadius(n),
      color: '#ffffff',
      weight: 1.5,
      fillColor: MARKET_COLOR,
      fillOpacity: 0.85,
      bubblingMouseEvents: false,
      interactive: !mapBusy(),
    });
    marker.bindTooltip(() => el('span', null, `${m.name} · 가맹점 ${numberFormat.format(n)}곳`), { direction: 'top', offset: [0, -6] });
    marker.bindPopup(() => marketPopup(m, selected ? n : null), { maxWidth: 320 });
    storeLayer.addLayer(marker);
  }
}

// 위치를 아는 모든 시장(흐린 회색 점). 지금 결과에 든 시장은 파란 점으로 따로 그린다.
function renderMarketBase() {
  marketBaseLayer.clearLayers();
  if (state.source !== 'onnuri') return;
  const inResult = new Set(state.data && state.data.source === 'onnuri' ? state.data.markets.map((m) => m.id) : []);
  for (const m of onnuri.markets) {
    if (inResult.has(m.id)) continue;
    const dot = L.circleMarker([m.lat, m.lng], {
      radius: 3.5,
      stroke: false,
      fillColor: OTHER_COLOR,
      fillOpacity: 0.6,
      bubblingMouseEvents: false,
      interactive: !mapBusy(),
    });
    dot.bindTooltip(() => el('span', null, `${m.name} · 가맹점 ${numberFormat.format(m.count)}곳`), { direction: 'top', offset: [0, -4] });
    dot.bindPopup(() => marketPopup(m, null), { maxWidth: 320 });
    marketBaseLayer.addLayer(dot);
  }
  restackLayers();
}

function marketPopup(m, shownCount) {
  const root = el('div', 'popup');
  root.append(el('strong', 'popup-title', m.name));
  const counts = `${m.sido} · 가맹점 ${numberFormat.format(m.count)}곳`;
  root.append(el('div', 'popup-count', shownCount != null ? `${counts} (골라 본 것 ${numberFormat.format(shownCount)}곳)` : counts));

  // 지금 결과에 이 시장 가맹점이 있으면 많은 품목 몇 개를 보여 준다.
  if (state.data && state.data.source === 'onnuri') {
    const items = [...countBy(state.data.stores.filter((s) => s.marketId === m.id), (s) => s.item || '(미기재)')].sort((a, b) => b[1] - a[1]);
    if (items.length) {
      const top = items.slice(0, 6).map(([item, n]) => `${item} ${n}`).join(' · ');
      root.append(el('div', 'popup-items', `많은 품목: ${top}${items.length > 6 ? ' …' : ''}`));
    }
  }
  const where = [LOC_SOURCE_LABEL[m.locSource] || '', m.locSource !== 'manual' ? m.locLabel : ''].filter(Boolean).join(' — ');
  root.append(el('div', 'popup-address', `위치: ${where}`));

  const actions = el('div', 'popup-actions');
  const fix = el('button', null, '위치 고치기');
  fix.type = 'button';
  fix.addEventListener('click', () => startPinning(m));
  actions.append(fix);
  if (m.locSource === 'manual') {
    const clear = el('button', null, '찍은 위치 지우기');
    clear.type = 'button';
    clear.addEventListener('click', () => clearPin(m));
    actions.append(clear);
  }
  root.append(actions);
  return root;
}

// ── 온누리: 시장 위치 직접 찍기 ────────────────────────────────────────
function startPinning(market) {
  if (drawing.active) stopDrawing();
  map.closePopup();
  pinning = { market };
  map.getContainer().classList.add('drawing');
  setStatus(`‘${market.name}’(${market.sido}) 자리를 지도에서 누르세요. 그만두려면 Esc를 누르세요.`, 'pin');
  render();
  renderSites();
}

function stopPinning() {
  pinning = null;
  if (!drawing.active) map.getContainer().classList.remove('drawing');
  render();
  renderSites();
}

async function savePin(latlng) {
  const { market } = pinning;
  stopPinning();
  try {
    await requestJson('/api/onnuri/location', { body: { id: market.id, lat: latlng.lat, lng: latlng.lng } });
    setStatus(`‘${market.name}’ 위치를 저장했어요.`);
  } catch (err) {
    setStatus(err.message, 'error');
    return;
  }
  await refreshOnnuri();
  if ($('onnuri-unlocated').open) loadUnlocated();
  rerunQuery();
}

async function clearPin(market) {
  map.closePopup();
  try {
    await requestJson('/api/onnuri/location', { body: { id: market.id, clear: true } });
    setStatus(`‘${market.name}’의 직접 찍은 위치를 지웠어요.`);
  } catch (err) {
    setStatus(err.message, 'error');
    return;
  }
  await refreshOnnuri();
  rerunQuery();
}

// ── 온누리: 파일·위치 현황 ──────────────────────────────────────────────
const onnuri = { status: null, markets: [], poll: null, marketsAt: 0, lastLocated: -1 };

async function refreshOnnuri() {
  try {
    onnuri.status = await requestJson('/api/onnuri/status');
    if (onnuri.status.loaded) {
      onnuri.markets = await requestJson('/api/onnuri/markets?located=yes');
      onnuri.marketsAt = Date.now();
      onnuri.lastLocated = onnuri.status.located;
    }
  } catch (err) {
    setOnnuriUploadStatus(err.message, 'error');
    return;
  }
  renderOnnuriPanel();
  renderMarketBase();
  pollOnnuri();
}

// 위치 자동 찾기가 도는 동안 2초마다 진행 상황을 보고, 새로 찾은 시장을 가끔 지도에 올린다.
function pollOnnuri() {
  clearTimeout(onnuri.poll);
  if (state.source !== 'onnuri' || !onnuri.status?.search.running) return;
  onnuri.poll = setTimeout(async () => {
    let st;
    try {
      st = await requestJson('/api/onnuri/status');
    } catch {
      pollOnnuri();
      return;
    }
    onnuri.status = st;
    if (!st.search.running) {
      await refreshOnnuri(); // 끝났다: 지도와 결과를 새로
      rerunQuery();
      return;
    }
    if (st.located !== onnuri.lastLocated && Date.now() - onnuri.marketsAt > 8000) {
      onnuri.markets = await requestJson('/api/onnuri/markets?located=yes').catch(() => onnuri.markets);
      onnuri.marketsAt = Date.now();
      onnuri.lastLocated = st.located;
      renderMarketBase();
    }
    renderOnnuriPanel();
    pollOnnuri();
  }, 2000);
}

function renderOnnuriPanel() {
  const st = onnuri.status;
  if (!st) return;
  $('onnuri-file').textContent = st.loaded
    ? [st.fileName || '가맹점 파일', formatDate(st.dataDate), `가맹점 ${numberFormat.format(st.stores)}곳`, `시장·상점가 ${numberFormat.format(st.markets)}곳`]
        .filter(Boolean)
        .join(' · ')
    : '공공데이터포털에서 받은 ‘온누리상품권 가맹점’ CSV 파일을 올려 주세요. 한 번 올리면 저장돼서 다음부터는 바로 씁니다.';
  if (st.error) setOnnuriUploadStatus(st.error, 'error');
  $('onnuri-locations').hidden = !st.loaded;
  if (!st.loaded) return;

  const share = st.markets ? st.located / st.markets : 0;
  $('onnuri-located').textContent =
    `위치를 아는 시장·상점가 ${numberFormat.format(st.located)} / ${numberFormat.format(st.markets)}곳 (${Math.round(share * 100)}%) — ` +
    `표준데이터 ${numberFormat.format(st.bySource.standard)} · 자동 검색 ${numberFormat.format(st.bySource.search)} · 직접 찍음 ${numberFormat.format(st.bySource.manual)}`;
  $('onnuri-progress').style.width = `${share * 100}%`;

  const select = $('onnuri-sido');
  if (select.options.length !== st.sidos.length + 1) {
    const current = select.value;
    select.replaceChildren(el('option', null, '전체 시도'), ...st.sidos.map((sido) => el('option', null, sido)));
    select.options[0].value = '';
    select.value = current;
  }
  const search = st.search;
  select.disabled = search.running;
  $('onnuri-search').textContent = search.running ? '멈추기' : '위치 자동 찾기';
  $('onnuri-search-status').textContent = search.running
    ? `${search.sido || '전체'} 찾는 중 ${numberFormat.format(search.done)} / ${numberFormat.format(search.total)}곳 · ` +
      `새로 찾음 ${numberFormat.format(search.found)}곳 · 남은 시간 약 ${formatDuration(search.etaSeconds)}`
    : search.message ||
      '시장 이름으로 주소 검색을 해서 위치를 채워요. 1초에 한 곳씩 찾아서 오래 걸리니, 필요한 시도만 골라 찾아도 돼요. 찾은 위치는 저장됩니다.';
  $('onnuri-retry').hidden = search.running || !st.notFound;
  $('onnuri-retry').textContent = `검색으로 못 찾은 ${numberFormat.format(st.notFound)}곳 다시 찾기`;
  $('onnuri-standard').textContent = st.standardRows
    ? `전국전통시장표준데이터 ${numberFormat.format(st.standardRows)}곳을 반영했어요.`
    : '전국전통시장표준데이터 CSV(공공데이터포털, 위도·경도 포함)도 여기 올리면 전통시장 위치를 한 번에 채워요.';
  $('onnuri-unlocated-title').textContent = `위치를 모르는 시장·상점가 (${numberFormat.format(st.markets - st.located)}곳)`;
}

async function loadUnlocated() {
  const q = $('onnuri-unlocated-q').value.trim();
  let list = [];
  try {
    list = await requestJson(`/api/onnuri/markets?${new URLSearchParams({ located: 'no', limit: '60', q })}`);
  } catch (err) {
    setOnnuriUploadStatus(err.message, 'error');
  }
  const ul = $('onnuri-unlocated-list');
  if (!list.length) {
    ul.replaceChildren(el('li', 'empty', q ? '그런 이름의 시장이 없어요.' : '모든 시장·상점가의 위치를 알고 있어요.'));
    return;
  }
  ul.replaceChildren(
    ...list.map((m) => {
      const li = el('li', 'unlocated-item');
      const text = el('div', 'unlocated-text');
      text.append(el('span', 'unlocated-name', m.name), el('span', 'unlocated-meta', `${m.sido} · 가맹점 ${numberFormat.format(m.count)}곳${m.notFound ? ' · 검색 실패' : ''}`));
      const pin = el('button', null, '지도에서 찍기');
      pin.type = 'button';
      pin.addEventListener('click', () => startPinning(m));
      li.append(text, pin);
      return li;
    }),
  );
}

async function onnuriSearch(action) {
  try {
    onnuri.status = await requestJson('/api/onnuri/search', { body: { action, sido: $('onnuri-sido').value } });
  } catch (err) {
    setOnnuriUploadStatus(err.message, 'error');
    return;
  }
  renderOnnuriPanel();
  pollOnnuri();
}

async function uploadOnnuriFiles(fileList) {
  const files = [...fileList].filter((f) => /\.csv$/i.test(f.name));
  if (!files.length) return;
  for (const file of files) {
    setOnnuriUploadStatus(`‘${file.name}’ 올리는 중… (${numberFormat.format(Math.round(file.size / 1024 / 1024))}MB)`, 'loading');
    let res;
    try {
      res = await fetch(`/api/onnuri/upload?${new URLSearchParams({ name: file.name })}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
    } catch {
      setOnnuriUploadStatus('지도 프로그램(까만 창)이 꺼져 있어요. 다시 켠 뒤 이 페이지를 새로고침하세요.', 'error');
      return;
    }
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      setOnnuriUploadStatus(payload?.error || `파일을 올리지 못했어요 (HTTP ${res.status})`, 'error');
      return;
    }
    setOnnuriUploadStatus(
      payload.kind === 'stores'
        ? `가맹점 ${numberFormat.format(payload.stores)}곳, 시장·상점가 ${numberFormat.format(payload.markets)}곳을 읽었어요.`
        : `전통시장 표준데이터 ${numberFormat.format(payload.standardRows)}곳을 반영했어요.`,
    );
  }
  if (state.source !== 'onnuri') {
    await setSource('onnuri');
  } else {
    await refreshOnnuri();
    rerunQuery();
  }
}

function setOnnuriUploadStatus(message, kind = '') {
  const status = $('onnuri-upload-status');
  status.textContent = message;
  status.className = `status ${kind}`;
  status.hidden = !message;
}

// ── 데이터 종류 바꾸기: 상가정보 ↔ 온누리 가맹점 ───────────────────────
async function setSource(source) {
  if (state.source === source) return;
  if (drawing.active) stopDrawing();
  if (pinning) stopPinning();
  state.request?.abort();
  state.source = source;
  state.generation++;
  state.level = SOURCES[source].levels[0][0];
  state.selectedKey = null;
  state.radiusData = null;
  state.data = null;
  for (const site of state.sites) {
    site.data = null;
    site.error = '';
    site.loading = false;
  }
  for (const b of document.querySelectorAll('[data-source]')) b.setAttribute('aria-checked', String(b.dataset.source === source));
  $('onnuri-panel').hidden = source !== 'onnuri';
  renderLegend();
  if (source === 'onnuri') {
    marketBaseLayer.addTo(map);
    setStatus('');
    await refreshOnnuri();
    if (!onnuri.status?.loaded) {
      render();
      renderSiteList();
      setStatus('먼저 위 [온누리 가맹점 파일]에서 CSV 파일을 올려 주세요.');
      return;
    }
  } else {
    marketBaseLayer.remove();
    clearTimeout(onnuri.poll);
  }
  render();
  renderSiteList();
  if (state.mode === 'radius' && state.center) searchAt(state.center, { fit: 'keep' });
  else if (state.mode === 'area' && currentSite()) loadSite(currentSite());
  else setStatus(state.mode === 'area' ? '대상지를 고르거나 새로 그려 보세요.' : '지도를 클릭하거나 주소를 검색해 보세요.');
}

// ── 전국 상권 현황 (시도별, 소상공인시장진흥공단 오픈API) ─────────────
// 시도별 표를 받은 그대로 쓴다. 열 이름이 바뀌어도 되도록, 시도 열과 숫자 열을 내용을 보고 찾는다.
const SIDO_CENTERS = {
  // 가까운 시도끼리 원이 겹치지 않게 몇 곳(인천·세종·대전·충남·전남)은 실제 중심에서 조금 옮겼다.
  서울: [37.5665, 126.978], 부산: [35.1796, 129.0756], 대구: [35.8714, 128.6014], 인천: [37.45, 126.45],
  광주: [35.1595, 126.8526], 대전: [36.3, 127.45], 울산: [35.5384, 129.3114], 세종: [36.6, 127.2],
  경기: [37.42, 127.52], 강원: [37.8, 128.25], 충북: [36.75, 127.75], 충남: [36.5, 126.75],
  전북: [35.72, 127.15], 전남: [34.75, 126.75], 경북: [36.35, 128.75], 경남: [35.3, 128.3], 제주: [33.38, 126.55],
};
const SIDO_PATTERNS = [
  ['서울', /^서울/], ['부산', /^부산/], ['대구', /^대구/], ['인천', /^인천/], ['광주', /^광주/], ['대전', /^대전/],
  ['울산', /^울산/], ['세종', /^세종/], ['경기', /^경기/], ['강원', /^강원/], ['충북', /^(충청북|충북)/],
  ['충남', /^(충청남|충남)/], ['전북', /^(전라북|전북)/], ['전남', /^(전라남|전남)/], ['경북', /^(경상북|경북)/],
  ['경남', /^(경상남|경남)/], ['제주', /^제주/], ['전국', /^(전국|합계|총계|계|total)$/i],
];
const KOREA_VIEW = L.latLngBounds([33.0, 124.6], [38.7, 131.0]);
const REGION_MAX_ZOOM = 9; // 시도 원은 멀리 볼 때만. 가까이 가면 도시 한가운데를 가려서 숨긴다.
const region = { data: null, sidoCol: '', numericCols: [], metricCols: [], metric: '', rows: [], total: null, shown: false };

// '서울특별시', '경상북도', '전북특별자치도', '경북' … → '서울', '경북', '전북' …
function canonicalSido(value) {
  const v = String(value ?? '').replace(/\s/g, '');
  if (!v) return '';
  if (/^전남광주/.test(v)) return '전남'; // 온누리 파일의 '전남광주'
  return SIDO_PATTERNS.find(([, pattern]) => pattern.test(v))?.[0] || '';
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

const formatValue = (value) => (typeof value === 'number' ? numberFormat.format(value) : String(value ?? ''));

function analyzeRegion(data) {
  const rows = data.rows;
  const sidoCol = data.columns.find((c) => rows.filter((r) => canonicalSido(r[c])).length >= Math.max(3, rows.length * 0.6)) || '';
  const numericCols = data.columns.filter(
    (c) => c !== sidoCol && rows.filter((r) => toNumber(r[c]) != null).length >= Math.max(1, rows.length * 0.8),
  );
  // 연도·코드 같은 열은 크기를 비교할 값이 아니라서 지도·순위에는 쓰지 않는다(표에는 나온다).
  const yearLike = (c) =>
    rows.every((r) => {
      const n = toNumber(r[c]);
      return n == null || (Number.isInteger(n) && n >= 1990 && n <= 2100);
    });
  const metricCols = numericCols.filter((c) => !/코드|code|번호|연번|순번|^no$/i.test(c) && !yearLike(c));
  Object.assign(region, {
    data,
    sidoCol,
    numericCols,
    metricCols,
    plainCols: new Set(numericCols.filter((c) => !metricCols.includes(c))), // 연도·코드: 쉼표 없이 그대로
    rows: rows.map((raw) => ({ raw, sido: sidoCol ? canonicalSido(raw[sidoCol]) : '' })),
  });
  region.total = region.rows.find((r) => r.sido === '전국') || null;
  if (!metricCols.includes(region.metric)) region.metric = metricCols[0] || '';
}

async function loadRegion(refresh = false) {
  setRegionStatus(refresh ? '새로 받는 중…' : '불러오는 중…', 'loading');
  try {
    const data = await requestJson(`/api/sangkwon${refresh ? '?refresh=1' : ''}`);
    analyzeRegion(data);
    setRegionStatus(data.warning ? `API를 쓸 수 없어서 올린 파일을 보여 줘요. — ${data.warning}` : '', data.warning ? 'error' : '');
  } catch (err) {
    setRegionStatus(err.message, 'error');
    return;
  }
  renderRegion();
  if (state.data) renderRegionNote();
}

function regionValue(row) {
  return toNumber(row.raw[region.metric]);
}

function renderRegion() {
  const d = region.data;
  if (!d) return;
  const sidos = region.rows.map((r) => r.sido).filter((x) => x && x !== '전국');
  const repeated = sidos.length !== new Set(sidos).size;
  $('region-info').textContent = [
    d.source === 'api' ? '공공데이터포털 오픈API' : `올린 파일${d.fileName ? ` (${d.fileName})` : ''}`,
    `${region.rows.length}줄 · 항목 ${d.columns.length}개`,
    !region.sidoCol ? '시도 열을 찾지 못해 지도에는 못 그리고 표로만 보여 줘요' : '',
    repeated ? '같은 시도가 여러 줄이라 지도에는 첫 줄만 그려요' : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const select = $('region-metric');
  if ([...select.options].map((o) => o.value).join('|') !== region.metricCols.join('|')) {
    select.replaceChildren(...region.metricCols.map((c) => el('option', null, c)));
  }
  select.value = region.metric;
  $('region-controls').hidden = !region.metricCols.length || !region.sidoCol;
  $('region-hint').hidden = $('region-controls').hidden;
  $('region-toggle').setAttribute('aria-pressed', String(region.shown));
  $('region-toggle').textContent = region.shown ? '지도에서 숨기기' : '지도에 보기';
  $('region-export').hidden = false;
  $('region-refresh').hidden = false;
  $('region-table-wrap').hidden = false;

  // 순위 목록 (시도만, 큰 순서). 비율은 '전국' 줄이 있으면 그 값, 없으면 시도 합계 기준.
  const list = $('region-list');
  const seen = new Set();
  const ranked = region.rows
    .filter((r) => r.sido && r.sido !== '전국' && regionValue(r) != null && !seen.has(r.sido) && seen.add(r.sido))
    .sort((a, b) => regionValue(b) - regionValue(a));
  if (!region.metric || !ranked.length) {
    list.replaceChildren();
  } else {
    const max = regionValue(ranked[0]) || 1;
    const whole = region.total ? regionValue(region.total) : ranked.reduce((n, r) => n + regionValue(r), 0);
    list.replaceChildren(
      ...ranked.map((r) => {
        const value = regionValue(r);
        const button = el('button', 'category');
        button.type = 'button';
        button.addEventListener('click', () => focusRegion(r));
        const count = el('span', 'category-count', formatValue(value));
        if (whole > 0) count.append(el('span', 'category-share', formatShare(value, whole)));
        const bar = el('span', 'category-bar');
        const fill = el('span');
        fill.style.width = `${Math.max(0, (value / max) * 100)}%`;
        fill.style.background = '#52514e';
        bar.append(fill);
        button.append(el('span', 'category-name', String(r.raw[region.sidoCol])), count, bar);
        const li = el('li');
        li.append(button);
        return li;
      }),
    );
  }

  // 표로 전체 보기
  const numeric = new Set(region.numericCols);
  const head = el('tr');
  for (const c of d.columns) head.append(el('th', null, c));
  const thead = el('thead');
  thead.append(head);
  const tbody = el('tbody');
  for (const row of d.rows) {
    const tr = el('tr');
    for (const c of d.columns) {
      const n = numeric.has(c) ? toNumber(row[c]) : null;
      const text = n != null && !region.plainCols.has(c) ? formatValue(n) : String(row[c] ?? '');
      tr.append(el('td', n != null ? 'num' : null, text));
    }
    tbody.append(tr);
  }
  $('region-table').replaceChildren(thead, tbody);

  drawRegionLayer();
}

function drawRegionLayer() {
  regionLayer.clearLayers();
  if (!region.shown || !region.metric || !region.sidoCol || map.getZoom() > REGION_MAX_ZOOM) return;
  const seen = new Set();
  const placed = region.rows.filter((r) => SIDO_CENTERS[r.sido] && !seen.has(r.sido) && seen.add(r.sido));
  const max = Math.max(1, ...placed.map((r) => regionValue(r) || 0));
  for (const r of placed) {
    const value = regionValue(r);
    const circle = L.circleMarker(SIDO_CENTERS[r.sido], {
      radius: 8 + 30 * Math.sqrt(Math.max(0, value || 0) / max),
      color: '#52514e',
      weight: 1.5,
      fillColor: '#52514e',
      fillOpacity: 0.14,
      bubblingMouseEvents: false,
      interactive: !mapBusy(),
    });
    circle.bindTooltip(
      () => {
        const box = el('div');
        box.append(el('div', null, r.sido), el('div', null, value == null ? '-' : formatValue(value)));
        return box;
      },
      { permanent: true, direction: 'center', className: 'region-label' },
    );
    circle.bindPopup(() => regionPopup(r), { maxWidth: 340 });
    r.layer = circle;
    regionLayer.addLayer(circle);
  }
  restackLayers();
}

function regionPopup(r) {
  const root = el('div', 'popup');
  root.append(el('strong', 'popup-title', `${r.raw[region.sidoCol]} 상권 현황`));
  const table = el('table', 'attr-table');
  for (const c of region.data.columns) {
    if (c === region.sidoCol) continue;
    const n = region.metricCols.includes(c) ? toNumber(r.raw[c]) : null;
    const tr = el('tr');
    tr.append(el('th', null, c), el('td', null, n != null ? formatValue(n) : String(r.raw[c] ?? '')));
    table.append(tr);
  }
  root.append(table);
  return root;
}

function focusRegion(r) {
  if (!region.shown) toggleRegion(true);
  const at = SIDO_CENTERS[r.sido];
  if (!at) return;
  map.setView(at, Math.min(map.getZoom(), 8));
  r.layer?.openPopup();
}

function toggleRegion(show = !region.shown) {
  region.shown = show;
  if (show) {
    regionLayer.addTo(map);
    if (map.getZoom() > REGION_MAX_ZOOM - 1) map.fitBounds(KOREA_VIEW);
  } else {
    regionLayer.remove();
  }
  renderRegion();
}

// 지금 결과(반경·대상지)가 속한 시도의 상권 현황을 한 줄로 보여 준다.
function renderRegionNote() {
  const note = $('region-note');
  const data = state.data;
  let sido = '';
  if (data && region.data) {
    const counts = countBy(data.stores, (s) => canonicalSido(s.sido));
    counts.delete('');
    sido = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  }
  const row = sido && region.rows.find((r) => r.sido === sido);
  note.hidden = !row;
  if (!row) return;
  const cols = (region.metricCols.length ? region.metricCols : region.numericCols).slice(0, 5);
  note.textContent = `${row.raw[region.sidoCol]} 상권 현황 — ${cols.map((c) => `${c} ${formatValue(toNumber(row.raw[c]) ?? row.raw[c])}`).join(' · ')}`;
}

async function exportRegionExcel() {
  const d = region.data;
  if (!d) return;
  const numeric = new Set(region.numericCols);
  const rows = [d.columns, ...d.rows.map((r) => d.columns.map((c) => (numeric.has(c) && toNumber(r[c]) != null ? toNumber(r[c]) : r[c] ?? '')))];
  const when = d.fetchedAt || d.savedAt;
  const bytes = await Xlsx.build([
    { name: '전국 상권 현황', rows, header: true, autoFilter: true, widths: d.columns.map((c) => Math.max(10, Math.min(30, c.length * 2 + 4))) },
    {
      name: '정보',
      header: true,
      widths: [12, 60],
      rows: [
        ['항목', '내용'],
        ['자료', '소상공인시장진흥공단_전국 상권 현황'],
        ['받은 곳', d.source === 'api' ? '공공데이터포털 오픈API' : `올린 파일 ${d.fileName || ''}`],
        ['받은 때', when ? new Date(when).toLocaleString('ko-KR') : '-'],
      ],
    },
  ]);
  download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), datedFileName(['전국 상권 현황'], 'xlsx'));
}

async function uploadRegionFile(file) {
  if (!file) return;
  setRegionStatus(`‘${file.name}’ 올리는 중…`, 'loading');
  let res;
  try {
    res = await fetch(`/api/sangkwon/upload?${new URLSearchParams({ name: file.name })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    });
  } catch {
    setRegionStatus('지도 프로그램(까만 창)이 꺼져 있어요. 다시 켠 뒤 이 페이지를 새로고침하세요.', 'error');
    return;
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    setRegionStatus(payload?.error || `파일을 올리지 못했어요 (HTTP ${res.status})`, 'error');
    return;
  }
  await loadRegion();
  if (region.data?.source === 'api') {
    setRegionStatus('파일을 저장했어요. 지금은 API가 잘 되어서 API 자료를 보여 주고, 올린 파일은 API가 안 될 때 씁니다.');
  }
}

function setRegionStatus(message, kind = '') {
  const status = $('region-status');
  status.textContent = message;
  status.className = `status ${kind}`;
  status.hidden = !message;
}

// ── 찾는 방법 바꾸기: 반경(원) ↔ 영역 직접 그리기 ──────────────────────
function setMode(mode) {
  if (state.mode === mode) return;
  if (drawing.active) stopDrawing();
  state.mode = mode;
  state.selectedKey = null;
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
  $('radius-panel').hidden = mode !== 'radius';
  $('site-panel').hidden = mode !== 'area';

  if (mode === 'radius') {
    siteLayer.remove();
    radiusLayer.addTo(map);
    state.data = state.radiusData;
    setStatus(state.data ? '' : '지도를 클릭하거나 주소를 검색해 보세요.');
  } else {
    radiusLayer.remove();
    siteLayer.addTo(map);
    if (!currentSite() && state.sites.length) state.selectedSiteId = state.sites[0].id;
    const site = currentSite();
    state.data = site?.data || null;
    if (site && !site.data && !site.loading) loadSite(site);
    else if (!site) setStatus('[＋ 새 대상지 그리기]를 누르고, 지도를 눌러 꼭짓점을 찍어 원하는 모양으로 영역을 만드세요.');
    else setStatus(site.error || '', site.error ? 'error' : '');
  }
  renderSites();
  render();
}

// ── 대상지 직접 그리기 ──────────────────────────────────────────────────
const DRAW_COLOR = '#0b0b0b';
const CLOSE_DISTANCE_PX = 12; // 첫 점에서 이만큼 안쪽을 누르면 영역을 닫는다
const drawing = { active: false, points: [], guide: null };

function startDrawing() {
  if (pinning) stopPinning();
  if (state.mode !== 'area') setMode('area');
  drawing.active = true;
  drawing.points = [];
  map.doubleClickZoom.disable();
  map.getContainer().classList.add('drawing');
  $('draw-help').hidden = false;
  $('draw-site').disabled = true;
  setStatus('');
  renderDrawing();
  renderSites(); // 그리는 동안 기존 대상지는 누르지 않게
  render(); // 가게 점도 누르지 않게
}

function stopDrawing() {
  drawing.active = false;
  drawing.points = [];
  drawing.guide = null;
  drawLayer.clearLayers();
  map.doubleClickZoom.enable();
  map.getContainer().classList.remove('drawing');
  $('draw-help').hidden = true;
  $('draw-site').disabled = false;
  renderSites();
  render();
}

function addDrawPoint(latlng) {
  const first = drawing.points[0];
  if (first && drawing.points.length >= 3) {
    const distance = map.latLngToContainerPoint(latlng).distanceTo(map.latLngToContainerPoint(first));
    if (distance <= CLOSE_DISTANCE_PX) {
      finishDrawing();
      return;
    }
  }
  drawing.points.push(L.latLng(latlng));
  renderDrawing();
}

function undoDrawPoint() {
  drawing.points.pop();
  renderDrawing();
}

function finishDrawing() {
  // 더블클릭하면 같은 자리에 점이 두 번 찍히므로, 화면에서 거의 겹치는 점은 하나로 친다.
  const points = [];
  for (const p of drawing.points) {
    const last = points[points.length - 1];
    if (!last || map.latLngToContainerPoint(p).distanceTo(map.latLngToContainerPoint(last)) > 3) points.push(p);
  }
  if (points.length > 3 && map.latLngToContainerPoint(points[0]).distanceTo(map.latLngToContainerPoint(points[points.length - 1])) <= 3) {
    points.pop();
  }
  if (points.length < 3) {
    setStatus('꼭짓점을 3개 이상 찍어야 영역이 만들어져요.', 'error');
    return;
  }
  stopDrawing();
  const site = {
    id: `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: nextSiteName(),
    points: points.map((p) => [Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6))]),
    data: null,
    loading: false,
    error: '',
  };
  state.sites.push(site);
  saveSites();
  selectSite(site.id);
}

function nextSiteName() {
  const used = new Set(state.sites.map((s) => s.name));
  let n = state.sites.length + 1;
  while (used.has(`대상지 ${n}`)) n++;
  return `대상지 ${n}`;
}

function renderDrawing() {
  drawLayer.clearLayers();
  drawing.guide = null;
  const pts = drawing.points;
  const count = pts.length;
  $('draw-count').textContent = count ? `꼭짓점 ${count}개` : '아직 찍은 점이 없어요';
  $('draw-finish').disabled = count < 3;
  $('draw-undo').disabled = count === 0;
  if (!drawing.active || !count) return;

  const quiet = { interactive: false, bubblingMouseEvents: true };
  if (count >= 2) L.polyline(pts, { ...quiet, color: DRAW_COLOR, weight: 2.5 }).addTo(drawLayer);
  if (count >= 3) L.polygon(pts, { ...quiet, stroke: false, fillColor: DRAW_COLOR, fillOpacity: 0.06 }).addTo(drawLayer);
  drawing.guide = L.polyline([], { ...quiet, color: DRAW_COLOR, weight: 1.5, dashArray: '5 5', opacity: 0.7 }).addTo(drawLayer);
  pts.forEach((p, i) => {
    // 첫 점은 크게: 다시 누르면 닫힌다는 표시
    L.circleMarker(p, {
      ...quiet,
      radius: i === 0 && count >= 3 ? 7 : 4,
      color: DRAW_COLOR,
      weight: 2,
      fillColor: i === 0 && count >= 3 ? '#fcd34d' : '#ffffff',
      fillOpacity: 1,
    }).addTo(drawLayer);
  });
}

// 마지막 점에서 마우스까지(그리고 첫 점으로 돌아가는) 안내선
map.on('mousemove', (e) => {
  if (!drawing.active || !drawing.guide || !drawing.points.length) return;
  const pts = drawing.points;
  drawing.guide.setLatLngs(pts.length >= 2 ? [pts[pts.length - 1], e.latlng, pts[0]] : [pts[0], e.latlng]);
});

map.on('dblclick', () => {
  if (drawing.active) finishDrawing();
});

document.addEventListener('keydown', (e) => {
  if (pinning && e.key === 'Escape') {
    stopPinning();
    setStatus('위치 찍기를 그만뒀어요.');
    return;
  }
  if (!drawing.active) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (e.key === 'Escape') {
    stopDrawing();
    setStatus('그리기를 취소했어요.');
  } else if (e.key === 'Enter' && !typing) {
    e.preventDefault();
    finishDrawing();
  } else if (!typing && (e.key === 'Backspace' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z'))) {
    e.preventDefault();
    undoDrawPoint();
  }
});

// ── 대상지 목록 ────────────────────────────────────────────────────────
const SITES_STORAGE_KEY = 'lifemomo.sites.v1';

function currentSite() {
  return state.sites.find((s) => s.id === state.selectedSiteId) || null;
}

function selectSite(id) {
  state.selectedSiteId = id;
  state.selectedKey = null;
  const site = currentSite();
  state.data = site?.data || null;
  renderSites();
  render();
  if (!site) return;
  const bounds = L.latLngBounds(site.points);
  if (!map.getBounds().contains(bounds)) map.fitBounds(bounds, { padding: [24, 24] });
  if (!site.data && !site.loading) loadSite(site);
  else setStatus(site.loading ? `‘${site.name}’ 안의 ${src().unitObj} 불러오는 중…` : site.error, site.loading ? 'loading' : site.error ? 'error' : '');
}

async function loadSite(site) {
  if (state.source === 'onnuri' && !onnuri.status?.loaded) {
    setStatus('먼저 위 [온누리 가맹점 파일]에서 CSV 파일을 올려 주세요.', 'error');
    return;
  }
  const generation = state.generation;
  site.loading = true;
  site.error = '';
  renderSiteList();
  if (site === currentSite()) setStatus(`‘${site.name}’ 안의 ${src().unitObj} 불러오는 중…`, 'loading');
  let data = null;
  let error = '';
  try {
    data = await requestJson(src().areaUrl, { body: { points: site.points } });
  } catch (err) {
    error = err.message;
  }
  if (generation !== state.generation) return; // 그사이 데이터 종류를 바꿨다
  if (data) prepareData(data);
  site.data = data;
  site.error = error;
  site.loading = false;
  if (!state.sites.includes(site)) return; // 불러오는 사이에 지웠다
  if (site === currentSite() && state.mode === 'area') {
    state.data = site.data;
    setStatus(site.error, site.error ? 'error' : '');
    render();
  }
  renderSiteList();
}

function renameSite(site) {
  const name = window.prompt('대상지 이름을 입력하세요', site.name);
  if (name == null) return;
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) return;
  site.name = trimmed;
  saveSites();
  renderSites();
  if (site === currentSite()) render();
}

function deleteSite(site) {
  if (!window.confirm(`‘${site.name}’을(를) 지울까요?`)) return;
  state.sites.splice(state.sites.indexOf(site), 1);
  saveSites();
  if (state.selectedSiteId === site.id) {
    state.selectedSiteId = null;
    state.data = null;
    state.selectedKey = null;
    setStatus('');
    render();
  }
  renderSites();
}

function renderSites() {
  siteLayer.clearLayers();
  for (const site of state.sites) {
    const selected = site.id === state.selectedSiteId;
    const polygon = L.polygon(site.points, {
      color: selected ? DRAW_COLOR : '#52514e',
      weight: selected ? 2.5 : 1.5,
      dashArray: selected ? null : '6 5',
      fillColor: DRAW_COLOR,
      fillOpacity: selected ? 0.05 : 0.02,
      interactive: !mapBusy(),
      bubblingMouseEvents: false,
    });
    polygon.on('click', () => selectSite(site.id));
    polygon.bindTooltip(() => el('span', null, site.name), {
      permanent: true,
      direction: 'center',
      className: `site-label${selected ? ' selected' : ''}`,
    });
    siteLayer.addLayer(polygon);
  }
  restackLayers();
  renderSiteList();
}

function renderSiteList() {
  const list = $('site-list');
  $('site-empty').hidden = state.sites.length > 0;
  $('export-sites').hidden = state.sites.length === 0;
  list.replaceChildren(
    ...state.sites.map((site) => {
      const selected = site.id === state.selectedSiteId;
      const item = el('li', `site-item${selected ? ' selected' : ''}`);
      const pick = el('button', 'site-pick');
      pick.type = 'button';
      pick.setAttribute('aria-pressed', String(selected));
      pick.addEventListener('click', () => selectSite(site.id));
      const status = site.loading
        ? '불러오는 중…'
        : site.error
          ? '불러오지 못함'
          : site.data
            ? `${numberFormat.format(site.data.stores.length)}${src().countUnit}`
            : '';
      pick.append(el('span', 'site-name', site.name), el('span', 'site-count', status));

      const actions = el('div', 'site-actions');
      const rename = el('button', null, '이름 바꾸기');
      rename.type = 'button';
      rename.addEventListener('click', () => renameSite(site));
      const remove = el('button', null, '지우기');
      remove.type = 'button';
      remove.addEventListener('click', () => deleteSite(site));
      actions.append(rename, remove);

      item.append(pick, actions);
      return item;
    }),
  );
}

// 그린 대상지(모양과 이름)는 이 브라우저에 저장해 두었다가 다음에 다시 보여 준다. 가게 목록은 저장하지 않는다.
function saveSites() {
  try {
    localStorage.setItem(SITES_STORAGE_KEY, JSON.stringify(state.sites.map(({ id, name, points }) => ({ id, name, points }))));
  } catch {
    // 저장이 막힌 브라우저(사생활 보호 모드 등)에서는 이번에만 쓴다.
  }
}

function loadSavedSites() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(SITES_STORAGE_KEY) || '[]');
  } catch {
    saved = [];
  }
  if (!Array.isArray(saved)) return;
  const valid = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
  state.sites = saved
    .filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string' && Array.isArray(s.points) && s.points.length >= 3 && s.points.every(valid))
    .map((s) => ({ id: s.id, name: s.name, points: s.points, data: null, loading: false, error: '' }));
}

// ── 대상지 모두 비교 엑셀 ───────────────────────────────────────────────
// 비교(대분류 × 대상지 개수표) + 대상지마다 가게 목록 시트.
async function exportSitesExcel() {
  const button = $('export-sites');
  button.disabled = true;
  try {
    for (const site of state.sites) {
      if (!site.data) {
        setStatus(`‘${site.name}’ 안의 ${src().unitObj} 불러오는 중…`, 'loading');
        await loadSite(site);
      }
      if (site.error || !site.data) throw new Error(`‘${site.name}’: ${site.error || '불러오지 못했습니다.'}`);
    }
    setStatus('');
    const sites = state.sites;
    const isOnnuri = state.source === 'onnuri';
    const keyOf = isOnnuri ? (s) => s.item || '(미기재)' : (s) => s.large || '미분류';
    const perSite = sites.map((site) => countBy(site.data.stores, keyOf));
    const totals = new Map();
    for (const counts of perSite) for (const [key, n] of counts) totals.set(key, (totals.get(key) || 0) + n);
    const categories = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')).map(([key]) => key);
    const siteTotal = (site) => site.data.stores.length;

    const compare = [
      [isOnnuri ? '취급품목' : '대분류', ...sites.map((s) => s.name), '합계'],
      ...categories.map((key) => [key, ...perSite.map((counts) => counts.get(key) || 0), totals.get(key)]),
      { bold: true, cells: ['합계', ...sites.map(siteTotal), sites.reduce((n, s) => n + siteTotal(s), 0)] },
      [],
    ];
    if (isOnnuri) compare.push(['시장·상점가 수', ...sites.map((s) => s.data.markets.length)]);
    compare.push(
      ['면적(㎡)', ...sites.map((s) => s.data.areaM2)],
      ['데이터 기준', ...sites.map((s) => (isOnnuri ? formatDate(s.data.dataDate) : formatYearMonth(s.data.stdrYm)) || '-')],
    );
    if (sites.some((s) => s.data.truncated)) {
      compare.push(['주의', '범위 안에 너무 많은 대상지는 일부만 불러왔습니다. 작게 나눠 그리면 전부 받을 수 있습니다.']);
    }
    if (isOnnuri && onnuri.status && onnuri.status.markets > onnuri.status.located) {
      compare.push(['주의', `위치를 모르는 시장·상점가 ${onnuri.status.markets - onnuri.status.located}곳은 지도에 없어 포함되지 않았습니다.`]);
    }

    const rank = new Map(categories.map((key, i) => [key, i]));
    const byCategory = (a, b) => rank.get(keyOf(a)) - rank.get(keyOf(b)) || a.name.localeCompare(b.name, 'ko');
    const yn = (v) => (v ? 'Y' : 'N');
    const siteSheet = (site) =>
      isOnnuri
        ? {
            name: site.name,
            header: true,
            autoFilter: true,
            widths: [24, 28, 32, 8, 8, 8, 12],
            rows: [
              ['취급품목', '가맹점명', '소속 시장·상점가', '소재지', '지류형', '디지털형', '가맹 등록년도'],
              ...[...site.data.stores].sort(byCategory).map((s) => [keyOf(s), s.name, s.market, s.sido, yn(s.paper), yn(s.digital), s.year]),
            ],
          }
        : {
            name: site.name,
            header: true,
            autoFilter: true,
            widths: [14, 28, 12, 16, 20, 40, 34, 8],
            rows: [
              ['대분류', '상호명', '지점명', '중분류', '소분류', '도로명주소', '지번주소', '층'],
              ...[...site.data.stores]
                .sort(byCategory)
                .map((s) => [keyOf(s), s.name, s.branch, s.medium, s.small, s.roadAddress || s.address, s.jibunAddress, formatFloor(s.floor)]),
            ],
          };

    const bytes = await Xlsx.build([
      { name: '비교', rows: compare, widths: [isOnnuri ? 24 : 14, ...sites.map(() => 14), 10], header: true },
      ...sites.map(siteSheet),
    ]);
    download(
      new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      datedFileName([src().filePrefix, '대상지 비교', `${sites.length}곳`], 'xlsx'),
    );
  } catch (err) {
    setStatus(`엑셀 파일을 만들지 못했어요: ${err.message}`, 'error');
  } finally {
    button.disabled = false;
  }
}

// ── 이벤트 연결 ─────────────────────────────────────────────────────────
for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => setMode(button.dataset.mode));
}
$('draw-site').addEventListener('click', startDrawing);
$('draw-finish').addEventListener('click', finishDrawing);
$('draw-undo').addEventListener('click', undoDrawPoint);
$('draw-cancel').addEventListener('click', () => {
  stopDrawing();
  setStatus('그리기를 취소했어요.');
});
$('export-sites').addEventListener('click', exportSitesExcel);
loadSavedSites();
renderSiteList();

$('export-xlsx').addEventListener('click', exportExcel);
$('export-shp').addEventListener('click', exportShp);

$('overlay-input').addEventListener('change', (e) => {
  importFiles(e.target.files);
  e.target.value = ''; // 같은 파일을 다시 골라도 change 가 오게
});

// 파일을 지도에 끌어다 놓기
const mapWrap = document.querySelector('.map-wrap');
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault()); // 브라우저가 파일을 열어 버리지 않게
window.addEventListener('drop', (e) => hasFiles(e) && e.preventDefault());
mapWrap.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  mapWrap.classList.add('dropping');
});
mapWrap.addEventListener('dragleave', (e) => {
  if (!mapWrap.contains(e.relatedTarget)) mapWrap.classList.remove('dropping');
});
mapWrap.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  mapWrap.classList.remove('dropping');
  const files = [...e.dataTransfer.files];
  const csv = files.filter((f) => /\.csv$/i.test(f.name));
  const rest = files.filter((f) => !/\.csv$/i.test(f.name));
  if (csv.length) uploadOnnuriFiles(csv);
  if (rest.length) importFiles(rest);
});

$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const query = $('query').value.trim();
  if (query) searchAddress(query);
});

for (const button of document.querySelectorAll('[data-radius]')) {
  button.addEventListener('click', () => {
    state.radius = Number(button.dataset.radius);
    for (const b of document.querySelectorAll('[data-radius]')) b.setAttribute('aria-checked', String(b === button));
    if (state.center) searchAt(state.center, { fit: 'auto' });
  });
}

for (const button of document.querySelectorAll('[data-source]')) {
  button.addEventListener('click', () => setSource(button.dataset.source));
}
$('onnuri-input').addEventListener('change', (e) => {
  uploadOnnuriFiles(e.target.files);
  e.target.value = '';
});
$('onnuri-search').addEventListener('click', () => onnuriSearch(onnuri.status?.search.running ? 'stop' : 'start'));
$('onnuri-retry').addEventListener('click', async () => {
  await onnuriSearch('retry');
  await onnuriSearch('start');
});
$('onnuri-unlocated').addEventListener('toggle', () => {
  if ($('onnuri-unlocated').open) loadUnlocated();
});
let unlocatedTimer = null;
$('onnuri-unlocated-q').addEventListener('input', () => {
  clearTimeout(unlocatedTimer);
  unlocatedTimer = setTimeout(loadUnlocated, 300);
});
$('region-panel').addEventListener('toggle', () => {
  if ($('region-panel').open && !region.data) loadRegion();
});
$('region-metric').addEventListener('change', (e) => {
  region.metric = e.target.value;
  renderRegion();
  if (state.data) renderRegionNote();
});
$('region-toggle').addEventListener('click', () => toggleRegion());
map.on('zoomend', () => {
  if (region.shown) drawRegionLayer();
});
$('region-refresh').addEventListener('click', () => loadRegion(true));
$('region-export').addEventListener('click', exportRegionExcel);
$('region-input').addEventListener('change', (e) => {
  uploadRegionFile(e.target.files[0]);
  e.target.value = '';
});
renderLegend();

$('clear-filter').addEventListener('click', () => {
  state.selectedKey = null;
  render();
});

requestJson('/api/config')
  .then((config) => {
    $('key-warning').hidden = config.hasKey;
  })
  .catch((err) => setStatus(err.message, 'error'));
