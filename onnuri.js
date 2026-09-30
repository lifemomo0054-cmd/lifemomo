'use strict';

// 온누리상품권 가맹점 파일(공공데이터포털 CSV)을 읽어 시장·상점가 단위로 지도에 올린다.
//
// 이 파일에는 가게 주소·좌표가 없고 '소속 시장명(또는 상점가)'과 '소재지(시도)'만 있다.
// 그래서 시장·상점가마다 위치를 따로 구한다(우선순위 순):
//   1) 사용자가 지도에서 직접 찍은 위치
//   2) 전국전통시장표준데이터 CSV(위도·경도 있음)에서 이름이 하나로만 맞는 시장
//   3) 시장 이름으로 주소 검색(Nominatim, 그 시도 범위 안에서만, 초당 1회)
// 올린 파일과 찾은 위치는 data/ 폴더에 저장해서 서버를 다시 켜도 그대로 쓴다.

const fs = require('node:fs/promises');
const path = require('node:path');
const { localMeters, insideRing, polygonAreaM2, distanceMeters, round6 } = require('./geo.js');

const STORES_FILE = 'onnuri-stores.csv';
const MARKETS_FILE = 'traditional-markets.csv';
const META_FILE = 'onnuri-meta.json';
const LOCATIONS_FILE = 'onnuri-locations.json';
const MAX_RESULT_STORES = 60_000;
const SEARCH_FAILURE_LIMIT = 5; // 주소 검색이 연달아 이만큼 실패하면(인터넷 끊김 등) 멈춘다

// 파일의 '소재지' 값 → 주소에 쓰이는 이름들, 대략의 경계 상자 [서, 남, 동, 북]
const SIDO = {
  서울: { names: ['서울특별시', '서울'], bbox: [126.76, 37.41, 127.19, 37.72] },
  부산: { names: ['부산광역시', '부산'], bbox: [128.76, 34.87, 129.32, 35.40] },
  대구: { names: ['대구광역시', '대구'], bbox: [128.35, 35.60, 128.95, 36.33] },
  인천: { names: ['인천광역시', '인천'], bbox: [124.60, 37.00, 126.80, 37.98] },
  광주: { names: ['광주광역시', '광주'], bbox: [126.64, 35.05, 127.02, 35.26] },
  대전: { names: ['대전광역시', '대전'], bbox: [127.24, 36.18, 127.56, 36.50] },
  울산: { names: ['울산광역시', '울산'], bbox: [128.95, 35.32, 129.47, 35.73] },
  세종: { names: ['세종특별자치시', '세종'], bbox: [127.14, 36.40, 127.41, 36.73] },
  경기: { names: ['경기도', '경기'], bbox: [126.37, 36.89, 127.86, 38.29] },
  강원: { names: ['강원특별자치도', '강원도', '강원'], bbox: [127.08, 37.02, 129.37, 38.62] },
  충북: { names: ['충청북도', '충북'], bbox: [127.27, 36.00, 128.66, 37.26] },
  충남: { names: ['충청남도', '충남'], bbox: [125.96, 35.97, 127.64, 37.08] },
  전북: { names: ['전북특별자치도', '전라북도', '전북'], bbox: [125.99, 35.29, 127.91, 36.16] },
  전남: { names: ['전라남도', '전남'], bbox: [125.06, 33.87, 127.90, 35.51] },
  경북: { names: ['경상북도', '경북'], bbox: [127.80, 35.57, 131.88, 37.55] },
  경남: { names: ['경상남도', '경남'], bbox: [127.57, 34.46, 129.23, 35.91] },
  제주: { names: ['제주특별자치도', '제주도', '제주'], bbox: [126.08, 33.10, 126.98, 33.58] },
};
SIDO.전남광주 = { names: [...SIDO.전남.names, ...SIDO.광주.names], bbox: SIDO.전남.bbox };

// 주소 검색이 안 될 때 떼어 보고 다시 찾을 이름 꼬리
const NAME_SUFFIXES = /(골목형\s*상점가|상점가\s*진흥조합|상점가|상인회|상인연합회|번영회|상권\s*활성화\s*(구역|사업단)?|전통시장|골목시장)$/;

// ── CSV ────────────────────────────────────────────────────────────────

// 공공데이터 CSV는 UTF-8(BOM 있음/없음) 또는 CP949(한글 Windows)다.
function decodeCsv(buffer) {
  let bytes = buffer;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('euc-kr').decode(bytes);
  }
}

// RFC 4180 CSV: 따옴표로 감싼 칸, 칸 안의 쉼표·줄바꿈, "" 를 처리한다.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let start = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (quoted) {
      if (c === 34) {
        if (text.charCodeAt(i + 1) === 34) {
          field += text.slice(start, i + 1);
          i++;
          start = i + 1;
        } else {
          field += text.slice(start, i);
          quoted = false;
          start = i + 1;
        }
      }
    } else if (c === 34 && i === start && field === '') {
      quoted = true;
      start = i + 1;
    } else if (c === 44) {
      row.push(field + text.slice(start, i));
      field = '';
      start = i + 1;
    } else if (c === 10 || c === 13) {
      row.push(field + text.slice(start, i));
      field = '';
      rows.push(row);
      row = [];
      if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
      start = i + 1;
    }
  }
  if (start < text.length || field || row.length) {
    row.push(field + text.slice(start));
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function findColumn(header, pattern) {
  return header.findIndex((h) => pattern.test(h.replace(/\s/g, '')));
}

// 머리글로 파일 종류를 알아낸다: 온누리 가맹점 목록 / 전국전통시장표준데이터
function detectKind(header) {
  if (findColumn(header, /가맹점명/) >= 0 && findColumn(header, /시장|상점가/) >= 0) return 'stores';
  if (findColumn(header, /시장명/) >= 0 && findColumn(header, /위도/) >= 0 && findColumn(header, /경도/) >= 0) return 'markets';
  return null;
}

function readStoresTable(rows) {
  const [header, ...body] = rows;
  const col = {
    name: findColumn(header, /가맹점명/),
    market: findColumn(header, /시장|상점가/),
    sido: findColumn(header, /소재지|시도/),
    item: findColumn(header, /취급품목|품목/),
    paper: findColumn(header, /지류/),
    digital: findColumn(header, /디지털|모바일|카드/),
    year: findColumn(header, /등록년도|등록연도|년도|연도/),
  };
  const cell = (r, i) => (i >= 0 && r[i] != null ? r[i].trim() : '');
  return body
    .map((r) => ({
      name: cell(r, col.name),
      market: cell(r, col.market),
      sido: cell(r, col.sido),
      item: cell(r, col.item),
      paper: /^(Y|예|O)$/i.test(cell(r, col.paper)),
      digital: /^(Y|예|O)$/i.test(cell(r, col.digital)),
      year: cell(r, col.year),
    }))
    .filter((s) => s.name && s.market);
}

function readMarketsTable(rows) {
  const [header, ...body] = rows;
  const col = {
    name: findColumn(header, /시장명/),
    road: findColumn(header, /도로명주소/),
    jibun: findColumn(header, /지번주소/),
    lat: findColumn(header, /위도/),
    lng: findColumn(header, /경도/),
  };
  const out = [];
  for (const r of body) {
    const lat = Number(r[col.lat]);
    const lng = Number(r[col.lng]);
    const name = (r[col.name] || '').trim();
    if (!name || !(lat > 32 && lat < 39.5 && lng > 124 && lng < 132)) continue;
    out.push({ name, address: ((col.road >= 0 && r[col.road]) || (col.jibun >= 0 && r[col.jibun]) || '').trim(), lat, lng });
  }
  return out;
}

// ── 이름 맞추기 ─────────────────────────────────────────────────────────
const normName = (s) => s.replace(/\(.*?\)|\[.*?\]/g, '').replace(/[\s·.,\-_'"]/g, '').toLowerCase();
const compact = (s) => s.replace(/\s/g, '');

function inSido(address, sido) {
  const info = SIDO[sido];
  if (!info) return true; // 모르는 시도면 주소로 거르지 않는다
  const a = compact(address);
  return info.names.some((n) => a.startsWith(compact(n)));
}

// 표준데이터에서 이름이 '하나로만' 맞는 시장을 찾는다. 같은 이름이 여럿이면(예: 경북 '중앙시장') 고르지 않는다.
// "김천중앙시장"처럼 지역 이름이 붙은 경우는 "중앙시장" 중 주소에 "김천"이 들어간 것을 찾는다.
function matchStandard(market, index) {
  const name = normName(market.name);
  const pick = (candidates) => {
    const unique = new Map(candidates.map((c) => [`${c.lat.toFixed(4)},${c.lng.toFixed(4)}`, c]));
    return unique.size === 1 ? [...unique.values()][0] : null;
  };
  const exact = (index.get(name) || []).filter((c) => inSido(c.address, market.sido));
  if (exact.length) return pick(exact);
  for (let k = 2; k <= name.length - 2; k++) {
    const place = name.slice(0, k);
    const rest = (index.get(name.slice(k)) || []).filter((c) => inSido(c.address, market.sido) && compact(c.address).includes(place));
    if (rest.length) return pick(rest);
  }
  return null;
}

// ── 모듈 ────────────────────────────────────────────────────────────────

// searchPlace(query, bbox) → { lat, lng, label } | null : 주소 검색(서버가 초당 1회로 조절해서 넘겨 준다)
function createOnnuri({ dataDir, searchPlace, log = console }) {
  const state = {
    loading: null,
    error: '',
    fileName: '',
    uploadedAt: '',
    stores: [],
    markets: [], // { id, name, sido, count, storeIdx: [], location, searched }
    byId: new Map(),
    standardCount: 0,
    saved: { markets: {}, notFound: {} }, // 직접 찍은 위치·주소 검색 결과
  };
  const search = { running: false, sido: '', total: 0, done: 0, found: 0, failures: 0, stop: false, message: '' };
  let saveTimer = null;

  const file = (name) => path.join(dataDir, name);

  async function readJson(name, fallback) {
    try {
      return JSON.parse(await fs.readFile(file(name), 'utf8'));
    } catch {
      return fallback;
    }
  }

  async function writeJson(name, value) {
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = file(`${name}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(value));
    await fs.rename(tmp, file(name));
  }

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writeJson(LOCATIONS_FILE, state.saved).catch((err) => log.error(`[온누리] 위치 저장 실패: ${err.message}`));
    }, 2000);
  }

  async function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    await writeJson(LOCATIONS_FILE, state.saved);
  }

  function load() {
    state.loading = (async () => {
      state.error = '';
      const meta = await readJson(META_FILE, {});
      state.fileName = meta.storesFile || '';
      state.uploadedAt = meta.storesUploadedAt || '';
      state.saved = await readJson(LOCATIONS_FILE, { markets: {}, notFound: {} });
      state.saved.markets ||= {};
      state.saved.notFound ||= {};

      let stores = [];
      try {
        stores = readStoresTable(parseCsv(decodeCsv(await fs.readFile(file(STORES_FILE)))));
      } catch (err) {
        if (err.code !== 'ENOENT') state.error = `가맹점 파일을 읽지 못했습니다: ${err.message}`;
      }
      let standard = [];
      try {
        standard = readMarketsTable(parseCsv(decodeCsv(await fs.readFile(file(MARKETS_FILE)))));
      } catch (err) {
        if (err.code !== 'ENOENT') state.error = `전통시장 표준데이터 파일을 읽지 못했습니다: ${err.message}`;
      }
      buildIndex(stores, standard);
    })();
    return state.loading;
  }

  function buildIndex(stores, standard) {
    const byId = new Map();
    stores.forEach((s, i) => {
      const id = `${s.sido}|${s.market}`;
      let m = byId.get(id);
      if (!m) {
        m = { id, name: s.market, sido: s.sido, count: 0, storeIdx: [], location: null };
        byId.set(id, m);
      }
      m.count++;
      m.storeIdx.push(i);
    });
    const index = new Map();
    for (const row of standard) {
      const key = normName(row.name);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(row);
    }
    for (const m of byId.values()) {
      const std = matchStandard(m, index);
      if (std) m.standardLocation = { lat: std.lat, lng: std.lng, source: 'standard', label: std.address };
      refreshLocation(m);
    }
    state.stores = stores;
    state.markets = [...byId.values()].sort((a, b) => b.count - a.count);
    state.byId = byId;
    state.standardCount = standard.length;
  }

  // 직접 찍은 위치 > 표준데이터 > 주소 검색
  function refreshLocation(m) {
    const saved = state.saved.markets[m.id];
    if (saved && saved.source === 'manual') m.location = saved;
    else if (m.standardLocation) m.location = m.standardLocation;
    else m.location = saved || null;
  }

  async function ready() {
    if (!state.loading) load();
    await state.loading;
  }

  function status() {
    const bySource = { manual: 0, standard: 0, search: 0 };
    for (const m of state.markets) if (m.location) bySource[m.location.source]++;
    const date = (state.fileName.match(/(20\d{6})/) || [])[1] || '';
    return {
      loaded: state.stores.length > 0,
      error: state.error,
      fileName: state.fileName,
      dataDate: date,
      stores: state.stores.length,
      markets: state.markets.length,
      located: bySource.manual + bySource.standard + bySource.search,
      bySource,
      notFound: state.markets.filter((m) => !m.location && state.saved.notFound[m.id]).length,
      unlocatedStores: state.markets.reduce((n, m) => n + (m.location ? 0 : m.count), 0),
      standardRows: state.standardCount,
      sidos: [...new Set(state.markets.map((m) => m.sido))].sort((a, b) => a.localeCompare(b, 'ko')),
      search: {
        running: search.running,
        sido: search.sido,
        total: search.total,
        done: search.done,
        found: search.found,
        message: search.message,
        etaSeconds: search.running ? Math.round((search.total - search.done) * 1.6) : 0,
      },
    };
  }

  const marketJson = (m, count = m.count) => ({
    id: m.id,
    name: m.name,
    sido: m.sido,
    count,
    lat: m.location ? m.location.lat : null,
    lng: m.location ? m.location.lng : null,
    locSource: m.location ? m.location.source : '',
    locLabel: m.location ? m.location.label || '' : '',
    notFound: !m.location && Boolean(state.saved.notFound[m.id]),
  });

  function listMarkets({ located = 'all', q = '', sido = '', limit = 5000 } = {}) {
    const query = normName(q);
    return state.markets
      .filter((m) => located === 'all' || (located === 'yes') === Boolean(m.location))
      .filter((m) => !sido || m.sido === sido)
      .filter((m) => !query || normName(m.name).includes(query))
      .slice(0, limit)
      .map((m) => marketJson(m));
  }

  function resultFor(markets, extra) {
    const out = [];
    let truncated = false;
    for (const m of markets) {
      for (const i of m.storeIdx) {
        if (out.length >= MAX_RESULT_STORES) {
          truncated = true;
          break;
        }
        const s = state.stores[i];
        out.push({ name: s.name, marketId: m.id, market: m.name, sido: s.sido, item: s.item, paper: s.paper, digital: s.digital, year: s.year });
      }
    }
    return {
      source: 'onnuri',
      ...extra,
      dataDate: status().dataDate,
      markets: markets.map((m) => marketJson(m)),
      stores: out,
      totalCount: out.length,
      truncated,
    };
  }

  function queryCircle({ lat, lng, radius }) {
    const inside = state.markets.filter((m) => m.location && distanceMeters(lat, lng, m.location.lat, m.location.lng) <= radius);
    return resultFor(inside, { kind: 'radius', center: { lat, lng }, radius });
  }

  function queryPolygon(points) {
    const ring = points.map(([lat, lng]) => [lng, lat]);
    const inside = state.markets.filter((m) => m.location && insideRing(m.location.lng, m.location.lat, ring));
    return resultFor(inside, { kind: 'area', points, areaM2: Math.round(polygonAreaM2(points)) });
  }

  function setLocation(id, lat, lng) {
    const m = state.byId.get(id);
    if (!m) return null;
    state.saved.markets[id] = { lat: round6(lat), lng: round6(lng), source: 'manual', label: '직접 찍은 위치' };
    delete state.saved.notFound[id];
    refreshLocation(m);
    scheduleSave();
    return marketJson(m);
  }

  function clearLocation(id) {
    const m = state.byId.get(id);
    if (!m) return null;
    delete state.saved.markets[id];
    refreshLocation(m);
    scheduleSave();
    return marketJson(m);
  }

  // 올린 파일을 종류에 맞는 이름으로 저장하고 다시 읽는다.
  async function saveUpload(buffer, originalName) {
    const rows = parseCsv(decodeCsv(buffer).slice(0, 20000));
    const kind = rows.length ? detectKind(rows[0]) : null;
    if (!kind) {
      throw new Error('온누리 가맹점 파일(가맹점명·소속 시장명 열)이나 전국전통시장표준데이터 파일(시장명·위도·경도 열)이 아닙니다.');
    }
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(file(kind === 'stores' ? STORES_FILE : MARKETS_FILE), buffer);
    const meta = await readJson(META_FILE, {});
    if (kind === 'stores') Object.assign(meta, { storesFile: originalName, storesUploadedAt: new Date().toISOString() });
    else Object.assign(meta, { marketsFile: originalName, marketsUploadedAt: new Date().toISOString() });
    await writeJson(META_FILE, meta);
    await load();
    return { kind, ...status() };
  }

  // ── 주소 검색으로 위치 찾기(백그라운드) ──
  async function findByName(m) {
    const bbox = SIDO[m.sido]?.bbox;
    const queries = [m.name.replace(/\(.*?\)/g, '').trim()];
    const shorter = queries[0].replace(NAME_SUFFIXES, '').trim();
    if (shorter.length >= 2 && shorter !== queries[0]) queries.push(shorter);
    for (const q of queries) {
      const hit = await searchPlace(q, bbox);
      if (hit) return hit;
    }
    return null;
  }

  function startSearch(sido = '') {
    if (search.running) return status();
    const queue = state.markets.filter((m) => !m.location && !state.saved.notFound[m.id] && (!sido || m.sido === sido));
    Object.assign(search, { running: true, sido, total: queue.length, done: 0, found: 0, failures: 0, stop: false, message: '' });
    (async () => {
      for (const m of queue) {
        if (search.stop) break;
        if (m.location) {
          search.done++;
          continue; // 그사이 직접 찍었다
        }
        try {
          const hit = await findByName(m);
          search.failures = 0;
          if (hit) {
            state.saved.markets[m.id] = { lat: round6(hit.lat), lng: round6(hit.lng), source: 'search', label: hit.label || '' };
            refreshLocation(m);
            search.found++;
          } else {
            state.saved.notFound[m.id] = new Date().toISOString();
          }
          scheduleSave();
        } catch (err) {
          search.failures++;
          if (search.failures >= SEARCH_FAILURE_LIMIT) {
            search.message = `주소 검색 서비스에 연결되지 않아 멈췄습니다 (${err.message}). 인터넷 연결을 확인하고 다시 시작하세요.`;
            break;
          }
        }
        search.done++;
      }
      search.running = false;
      if (!search.message) search.message = search.stop ? '멈췄습니다.' : `끝났습니다. ${search.found}곳을 새로 찾았습니다.`;
      await flush().catch(() => {});
    })();
    return status();
  }

  function stopSearch() {
    search.stop = true;
    return status();
  }

  // 못 찾음 표시를 지워서 다음 검색 때 다시 시도하게 한다.
  function retryNotFound(sido = '') {
    for (const m of state.markets) if (!sido || m.sido === sido) delete state.saved.notFound[m.id];
    scheduleSave();
    return status();
  }

  return {
    ready,
    load,
    status,
    listMarkets,
    queryCircle,
    queryPolygon,
    setLocation,
    clearLocation,
    saveUpload,
    startSearch,
    stopSearch,
    retryNotFound,
    flush,
    has: (id) => state.byId.has(id),
  };
}

module.exports = { createOnnuri, parseCsv, decodeCsv, detectKind, readStoresTable, readMarketsTable, matchStandard, normName, SIDO };
