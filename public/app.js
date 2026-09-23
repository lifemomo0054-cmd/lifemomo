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

// ── 이벤트 연결 ─────────────────────────────────────────────────────────
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
