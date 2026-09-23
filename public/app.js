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
  center: null, // L.LatLng
  radius: 500,
  data: null, // /api/stores 응답
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

const areaLayer = L.layerGroup().addTo(map);
const storeLayer = L.layerGroup().addTo(map);

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
  $('candidates').hidden = true;
  searchAt(e.latlng, { fit: 'auto' });
});

// ── 조회 ────────────────────────────────────────────────────────────────
async function searchAt(latlng, { fit }) {
  state.center = L.latLng(latlng);
  state.data = null;
  state.selectedKey = null;
  drawArea(fit);
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
    const data = await getJson(`/api/stores?${params}`, controller.signal);
    for (const s of data.stores) s.color = colorForLarge(s.large);
    state.data = data;
    setStatus('');
  } catch (err) {
    if (err.name === 'AbortError') return;
    setStatus(err.message, 'error');
  } finally {
    if (state.request === controller) state.request = null;
  }
  render();
}

function drawArea(fit) {
  areaLayer.clearLayers();
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
  }).addTo(areaLayer);
  L.marker(state.center, {
    icon: L.divIcon({ className: 'center-pin', iconSize: [18, 18] }),
    interactive: false,
    keyboard: false,
  }).addTo(areaLayer);

  const bounds = circle.getBounds();
  if (fit === 'always' || !map.getBounds().contains(bounds)) {
    map.fitBounds(bounds, { padding: [24, 24] });
  }
}

async function searchAddress(query) {
  $('candidates').hidden = true;
  setStatus('주소를 찾는 중…', 'loading');
  let results;
  try {
    results = await getJson(`/api/geocode?${new URLSearchParams({ q: query })}`);
  } catch (err) {
    setStatus(err.message, 'error');
    return;
  }
  if (!results.length) {
    setStatus('주소를 찾지 못했어요. 도로명·지번 주소나 역·건물 이름으로 다시 검색해 보세요.', 'error');
    return;
  }
  showCandidates(results, 0);
  searchAt(results[0], { fit: 'always' });
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
      searchAt(r, { fit: 'always' });
    });
    const li = el('li');
    li.append(button);
    list.append(li);
  });
}

async function getJson(url, signal) {
  let res;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(
      '지도 프로그램(까만 창)이 꺼져 있어요. 폴더의 start-windows를 더블클릭해서(또는 npm start로) 다시 켠 뒤 이 페이지를 새로고침하세요.',
    );
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `서버 응답 오류 (HTTP ${res.status})`);
  return body;
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
  $('summary-meta').textContent = [`반경 ${formatRadius(data.radius)}`, formatYearMonth(data.stdrYm)].filter(Boolean).join(' · ');

  const truncated = $('truncated');
  truncated.hidden = !data.truncated;
  truncated.textContent = data.truncated
    ? `이 반경에는 가게가 ${numberFormat.format(data.totalCount)}개 있지만 ${numberFormat.format(stores.length)}개만 불러왔어요. ` +
      '업종별 개수도 불러온 가게 기준입니다. 반경을 줄이면 전부 볼 수 있어요.'
    : '';

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
    list.replaceChildren(el('li', 'empty', '이 반경 안에는 등록된 가게가 없어요.'));
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

// 예: 상가_김천시 자산동_전체_반경300m_20260923.xlsx
function fileName(what, extension) {
  const d = new Date();
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const parts = ['상가', placeName(), what, `반경${formatRadius(state.data.radius)}`, day].filter(Boolean);
  return `${parts.join('_')}.${extension}`.replace(/[\\/:*?"<>|]/g, '·');
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
      ['위치', [placeName(), `위도 ${data.center.lat}, 경도 ${data.center.lng}`].filter(Boolean).join(' · ')],
      ['반경', formatRadius(data.radius)],
      ['데이터 기준', formatYearMonth(data.stdrYm) || '-'],
      ['가게 수', total],
    ];
    if (data.truncated) summaryRows.push(['주의', `가게가 ${data.totalCount}개라 ${total}개만 불러왔습니다. 반경을 줄이면 전부 받을 수 있습니다.`]);
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
  group.bringToBack(); // 가게 점보다 아래에 그려서 점을 누를 수 있게 한다.
  overlay.layer = group;

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

// ── 이벤트 연결 ─────────────────────────────────────────────────────────
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

getJson('/api/config')
  .then((config) => {
    $('key-warning').hidden = config.hasKey;
  })
  .catch((err) => setStatus(err.message, 'error'));
