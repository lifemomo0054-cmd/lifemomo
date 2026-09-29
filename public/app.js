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
};

const state = {
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
const storeLayer = L.layerGroup().addTo(map);
const drawLayer = L.layerGroup().addTo(map); // 그리는 중인 선

const legend = L.control({ position: 'bottomleft' });
legend.onAdd = () => {
  const box = L.DomUtil.create('div', 'legend');
  for (const { label, color } of [...LARGE_COLORS, { label: '그 밖의 업종', color: OTHER_COLOR }]) {
    const item = el('span', 'legend-item', label);
    item.prepend(swatch(color));
    box.append(item);
  }
  return box;
};
legend.addTo(map);

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
  state.center = L.latLng(latlng);
  state.data = null;
  state.radiusData = null;
  state.selectedKey = null;
  drawRadius(fit);
  render();

  state.request?.abort();
  const controller = new AbortController();
  state.request = controller;
  setStatus(`반경 ${formatRadius(state.radius)} 안의 가게를 불러오는 중…`, 'loading');

  const params = new URLSearchParams({
    lat: state.center.lat.toFixed(6),
    lng: state.center.lng.toFixed(6),
    radius: String(state.radius),
  });
  try {
    const data = await requestJson(`/api/stores?${params}`, { signal: controller.signal });
    for (const s of data.stores) s.color = colorForLarge(s.large);
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
  if (fit === 'always' || !map.getBounds().contains(bounds)) {
    map.fitBounds(bounds, { padding: [24, 24] });
  }
}

// 그리는 순서(아래→위): 내 SHP → 대상지 → 반경 원 → 가게 점. 점이 늘 맨 위에 있어야 누를 수 있다.
function restackLayers() {
  radiusLayer.eachLayer((l) => l.bringToBack && l.bringToBack());
  siteLayer.eachLayer((l) => l.bringToBack && l.bringToBack());
  for (const overlay of overlays) overlay.layer?.bringToBack();
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
}

function renderStores() {
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
      interactive: !drawing.active, // 그리는 중에는 점을 눌러도 꼭짓점이 찍히게
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

  const stores = data.stores;
  $('total-count').textContent = numberFormat.format(stores.length);
  const scope = scopeInfo();
  $('summary-meta').textContent = [scope.meta, formatYearMonth(data.stdrYm)].filter(Boolean).join(' · ');

  const truncated = $('truncated');
  truncated.hidden = !data.truncated;
  truncated.textContent = !data.truncated
    ? ''
    : data.kind === 'area'
      ? `이 대상지는 가게가 많아서 일부(${numberFormat.format(stores.length)}개)만 불러왔어요. ` +
        '업종별 개수도 불러온 가게 기준입니다. 대상지를 작게 나눠 그리면 전부 볼 수 있어요.'
      : `이 반경에는 가게가 ${numberFormat.format(data.totalCount)}개 있지만 ${numberFormat.format(stores.length)}개만 불러왔어요. ` +
        '업종별 개수도 불러온 가게 기준입니다. 반경을 줄이면 전부 볼 수 있어요.';

  for (const button of document.querySelectorAll('[data-level]')) {
    button.setAttribute('aria-pressed', String(button.dataset.level === state.level));
  }

  const level = LEVELS[state.level];
  const groups = new Map();
  for (const s of stores) {
    const key = level.key(s);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: level.label(s) || '미분류', parent: level.parent(s), color: s.color, count: 0 };
      groups.set(key, group);
    }
    group.count++;
  }
  const rows = [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko'));

  const selectedRow = rows.find((r) => r.key === state.selectedKey);
  $('filter-chip').hidden = !selectedRow;
  $('filter-label').textContent = selectedRow ? `‘${selectedRow.label}’ ${numberFormat.format(selectedRow.count)}개만 보는 중` : '';

  $('export-xlsx').disabled = stores.length === 0;
  $('export-xlsx').textContent = `엑셀로 저장 (${numberFormat.format(stores.length)}개)`;
  const exportCount = numberFormat.format(visibleStores().length);
  $('export-shp').disabled = stores.length === 0;
  $('export-shp').textContent = selectedRow
    ? `‘${selectedRow.label}’만 SHP로 저장 (${exportCount}개)`
    : `SHP로 저장 (${exportCount}개)`;

  const list = $('category-list');
  if (!rows.length) {
    list.replaceChildren(el('li', 'empty', `${scope.where} 안에는 등록된 가게가 없어요.`));
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

async function exportShp() {
  const stores = visibleStores();
  if (!stores.length) return;
  const button = $('export-shp');
  button.disabled = true;
  try {
    const set = Shapefile.writePointShapefile(
      stores.map((s) => ({
        x: s.lng,
        y: s.lat,
        attributes: Object.fromEntries(SHP_FIELDS.map((f) => [f.name, f.from(s)])),
      })),
      SHP_FIELDS,
    );
    const text = new TextEncoder();
    const zipBytes = await Shapefile.zip([
      { name: 'stores.shp', data: set.shp },
      { name: 'stores.shx', data: set.shx },
      { name: 'stores.dbf', data: set.dbf },
      { name: 'stores.prj', data: text.encode(Shapefile.WGS84_PRJ) },
      { name: 'stores.cpg', data: text.encode('UTF-8') },
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
  return datedFileName(['상가', ...scopeInfo().fileParts(what)], extension);
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
  renderStores(); // 가게 점도 누르지 않게
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
  renderStores();
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
  else setStatus(site.loading ? `‘${site.name}’ 안의 가게를 불러오는 중…` : site.error, site.loading ? 'loading' : site.error ? 'error' : '');
}

async function loadSite(site) {
  site.loading = true;
  site.error = '';
  renderSiteList();
  if (site === currentSite()) setStatus(`‘${site.name}’ 안의 가게를 불러오는 중…`, 'loading');
  try {
    const data = await requestJson('/api/stores/area', { body: { points: site.points } });
    for (const s of data.stores) s.color = colorForLarge(s.large);
    site.data = data;
  } catch (err) {
    site.error = err.message;
  }
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
      interactive: !drawing.active,
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
            ? `${numberFormat.format(site.data.stores.length)}개`
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
        setStatus(`‘${site.name}’ 안의 가게를 불러오는 중…`, 'loading');
        await loadSite(site);
      }
      if (site.error) throw new Error(`‘${site.name}’: ${site.error}`);
    }
    setStatus('');
    const sites = state.sites;
    const totals = new Map();
    for (const site of sites) {
      for (const s of site.data.stores) totals.set(s.large || '미분류', (totals.get(s.large || '미분류') || 0) + 1);
    }
    const categories = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')).map(([label]) => label);
    const countIn = (site, label) => site.data.stores.filter((s) => (s.large || '미분류') === label).length;

    const compare = [
      ['대분류', ...sites.map((s) => s.name), '합계'],
      ...categories.map((label) => [label, ...sites.map((s) => countIn(s, label)), totals.get(label)]),
      { bold: true, cells: ['합계', ...sites.map((s) => s.data.stores.length), sites.reduce((n, s) => n + s.data.stores.length, 0)] },
      [],
      ['면적(㎡)', ...sites.map((s) => s.data.areaM2)],
      ['데이터 기준', ...sites.map((s) => formatYearMonth(s.data.stdrYm) || '-')],
    ];
    if (sites.some((s) => s.data.truncated)) {
      compare.push(['주의', '가게가 많은 대상지는 일부만 불러왔습니다. 작게 나눠 그리면 전부 받을 수 있습니다.']);
    }

    const header = ['대분류', '상호명', '지점명', '중분류', '소분류', '도로명주소', '지번주소', '층'];
    const rank = new Map(categories.map((label, i) => [label, i]));
    const siteSheet = (site) => ({
      name: site.name,
      header: true,
      autoFilter: true,
      widths: [14, 28, 12, 16, 20, 40, 34, 8],
      rows: [
        header,
        ...[...site.data.stores]
          .sort((a, b) => rank.get(a.large || '미분류') - rank.get(b.large || '미분류') || a.name.localeCompare(b.name, 'ko'))
          .map((s) => [s.large || '미분류', s.name, s.branch, s.medium, s.small, s.roadAddress || s.address, s.jibunAddress, formatFloor(s.floor)]),
      ],
    });

    const bytes = await Xlsx.build([
      { name: '비교', rows: compare, widths: [14, ...sites.map(() => 14), 10], header: true },
      ...sites.map(siteSheet),
    ]);
    download(
      new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      datedFileName(['상가', '대상지 비교', `${sites.length}곳`], 'xlsx'),
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
  importFiles(e.dataTransfer.files);
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

for (const button of document.querySelectorAll('[data-level]')) {
  button.addEventListener('click', () => {
    state.level = button.dataset.level;
    state.selectedKey = null;
    render();
  });
}

$('clear-filter').addEventListener('click', () => {
  state.selectedKey = null;
  render();
});

requestJson('/api/config')
  .then((config) => {
    $('key-warning').hidden = config.hasKey;
  })
  .catch((err) => setStatus(err.message, 'error'));
