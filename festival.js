'use strict';

// 축제 정보 CSV(예: 경상북도 축제 정보)를 읽어 지도에 올린다.
// 좌표가 없고 도로명주소만 있어서, 주소로 위치를 찾는다(주소 검색, 초당 1회, 한 번 찾으면 저장).
// 주소로 못 찾으면 시군 중심에 '대략'으로 놓고, 사용자가 지도에서 직접 고칠 수 있다.

const fs = require('node:fs/promises');
const path = require('node:path');
const { parseCsv, decodeCsv, SIDO } = require('./onnuri.js');
const { round6 } = require('./geo.js');

const DATA_FILE = 'festivals.csv';
const META_FILE = 'festivals-meta.json';
const LOCATIONS_FILE = 'festival-locations.json';
const EMPTY = /^(정보\s*없음|없음|-|n\/?a)$/i;
const SEARCH_FAILURE_LIMIT = 5;

function findColumn(header, pattern) {
  return header.findIndex((h) => pattern.test(h.replace(/\s/g, '')));
}

function isFestivalHeader(header) {
  return findColumn(header, /축제명|행사명/) >= 0 && findColumn(header, /주소/) >= 0;
}

function readFestivals(rows) {
  const [header, ...body] = rows;
  const col = {
    region: findColumn(header, /지역명|시군/),
    name: findColumn(header, /축제명|행사명/),
    address: findColumn(header, /도로명주소|주소/),
    phone: findColumn(header, /전화/),
    start: findColumn(header, /시작일/),
    end: findColumn(header, /종료일/),
    detail: findColumn(header, /상세정보/),
    homepage: findColumn(header, /홈페이지/),
    host: findColumn(header, /주최/),
  };
  const cell = (r, i) => {
    const v = i >= 0 && r[i] != null ? r[i].trim() : '';
    return EMPTY.test(v) ? '' : v;
  };
  return body
    .map((r, i) => ({
      id: String(i),
      name: cell(r, col.name),
      region: cell(r, col.region),
      address: cell(r, col.address).replace(/\s+/g, ' '),
      phone: cell(r, col.phone),
      start: cell(r, col.start),
      end: cell(r, col.end),
      detailUrl: cell(r, col.detail),
      homepage: cell(r, col.homepage),
      host: cell(r, col.host),
    }))
    .filter((f) => f.name);
}

// "경북 예천군 …" → "경상북도 예천군 …" (주소 검색이 줄임말을 잘 모른다)
function expandSido(address) {
  const [first, ...rest] = address.split(' ');
  const info = SIDO[first];
  return info && first !== '전남광주' ? [info.names[0], ...rest].join(' ') : address;
}

function sidoOf(address) {
  const a = address.replace(/\s/g, '');
  for (const [key, info] of Object.entries(SIDO)) {
    if (key !== '전남광주' && info.names.some((n) => a.startsWith(n))) return key;
  }
  return '';
}

// 주소 뒤에 붙은 설명("… 509 영주시 소백산 일원")을 떼고, 도로명+번호 → 도로명 → 지번 순으로 찾아 본다.
// 주소 대신 장소 이름만 적힌 경우("탈춤공원 벚꽃길 일원")는 꼬리를 떼고 지역명을 붙여 찾는다.
function addressQueries(address, region = '') {
  const full = expandSido(address.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim());
  const queries = [];
  const road = full.match(/^(.*?\S(?:로|길))\s*(\d+(?:-\d+)?)(?=\s|$)/);
  if (road) queries.push(`${road[1]} ${road[2]}`, road[1]);
  const jibun = full.match(/^(.*?\S(?:동|리|가))\s*(\d+(?:-\d+)?)(?=\s|$)/);
  if (jibun) queries.push(`${jibun[1]} ${jibun[2]}`);
  if (!queries.length && full) {
    const place = full.replace(/\s+및\s.*$/, '').replace(/\s*(일원|일대|일\s*원|주변|앞)$/, '').trim();
    if (place) queries.push(region && !place.includes(region) ? `${region} ${place}` : place);
  }
  return [...new Set(queries)];
}

// 주소에서 "경상북도 영주시"처럼 시군까지만. 주소에 없으면 파일의 시도 + 지역명("경상북도 안동").
function cityQuery(address, region = '', sidoName = '') {
  const full = expandSido(address.replace(/\s+/g, ' ').trim());
  const m = full.match(/^(\S+)\s+(\S+?(?:시|군|구))(?=\s|$)/);
  if (m && SIDO[sidoOf(m[1])]) return `${m[1]} ${m[2]}`;
  return region ? `${sidoName} ${region}`.trim() : '';
}

function createFestivals({ dataDir, searchPlace, log = console }) {
  const state = { loading: null, error: '', fileName: '', festivals: [], saved: { places: {}, notFound: {} } };
  const search = { running: false, total: 0, done: 0, found: 0, approx: 0, failures: 0, stop: false, message: '' };
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
    await fs.writeFile(file(`${name}.tmp`), JSON.stringify(value));
    await fs.rename(file(`${name}.tmp`), file(name));
  }

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writeJson(LOCATIONS_FILE, state.saved).catch((err) => log.error(`[축제] 위치 저장 실패: ${err.message}`));
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
      state.fileName = (await readJson(META_FILE, {})).fileName || '';
      state.saved = await readJson(LOCATIONS_FILE, { places: {}, notFound: {} });
      state.saved.places ||= {};
      state.saved.notFound ||= {};
      try {
        state.festivals = readFestivals(parseCsv(decodeCsv(await fs.readFile(file(DATA_FILE)))));
      } catch (err) {
        state.festivals = [];
        if (err.code !== 'ENOENT') state.error = `축제 파일을 읽지 못했습니다: ${err.message}`;
      }
    })();
    return state.loading;
  }

  async function ready() {
    if (!state.loading) load();
    await state.loading;
  }

  const addresses = () => [...new Set(state.festivals.map((f) => f.address).filter(Boolean))];

  function status() {
    const bySource = { manual: 0, search: 0, approx: 0 };
    const all = addresses();
    for (const a of all) if (state.saved.places[a]) bySource[state.saved.places[a].source]++;
    const located = bySource.manual + bySource.search + bySource.approx;
    return {
      loaded: state.festivals.length > 0,
      error: state.error,
      fileName: state.fileName,
      dataDate: (state.fileName.match(/(20\d{6})/) || [])[1] || '',
      festivals: state.festivals.length,
      addresses: all.length,
      located,
      bySource,
      notFound: all.filter((a) => !state.saved.places[a] && state.saved.notFound[a]).length,
      search: {
        running: search.running,
        total: search.total,
        done: search.done,
        found: search.found,
        approx: search.approx,
        message: search.message,
        etaSeconds: search.running ? Math.round((search.total - search.done) * 2.5) : 0,
      },
    };
  }

  function list() {
    return state.festivals.map((f) => {
      const place = state.saved.places[f.address];
      return {
        ...f,
        lat: place ? place.lat : null,
        lng: place ? place.lng : null,
        locSource: place ? place.source : '',
        locLabel: place ? place.label || '' : '',
      };
    });
  }

  function setLocation(address, lat, lng) {
    if (!addresses().includes(address)) return false;
    state.saved.places[address] = { lat: round6(lat), lng: round6(lng), source: 'manual', label: '직접 찍은 위치' };
    delete state.saved.notFound[address];
    scheduleSave();
    return true;
  }

  function clearLocation(address) {
    if (!addresses().includes(address)) return false;
    delete state.saved.places[address];
    scheduleSave();
    return true;
  }

  async function saveUpload(buffer, originalName) {
    const rows = parseCsv(decodeCsv(buffer));
    if (!rows.length || !isFestivalHeader(rows[0])) {
      throw new Error('축제 정보 파일이 아닙니다(축제명·주소 열이 있어야 합니다).');
    }
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(file(DATA_FILE), buffer);
    await writeJson(META_FILE, { fileName: originalName, uploadedAt: new Date().toISOString() });
    await load();
    return status();
  }

  // 파일에서 가장 많이 나오는 시도(주소에 시도가 빠진 줄에 쓴다)
  function mainSido() {
    const counts = new Map();
    for (const f of state.festivals) {
      const sido = sidoOf(expandSido(f.address));
      if (sido) counts.set(sido, (counts.get(sido) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  }

  async function locate(address, region, fallbackSido) {
    const sido = sidoOf(expandSido(address)) || fallbackSido;
    const bbox = SIDO[sido]?.bbox;
    for (const q of addressQueries(address, region)) {
      const hit = await searchPlace(q, bbox);
      if (hit) return { lat: hit.lat, lng: hit.lng, source: 'search', label: hit.label || q };
    }
    const city = cityQuery(address, region, SIDO[sido]?.names[0] || '');
    if (city) {
      const hit = await searchPlace(city, bbox);
      if (hit) return { lat: hit.lat, lng: hit.lng, source: 'approx', label: `${city} 중심(대략)` };
    }
    return null;
  }

  function startSearch() {
    if (search.running) return status();
    const regionOf = new Map(state.festivals.map((f) => [f.address, f.region]));
    const fallbackSido = mainSido();
    const queue = addresses().filter((a) => !state.saved.places[a] && !state.saved.notFound[a]);
    Object.assign(search, { running: true, total: queue.length, done: 0, found: 0, approx: 0, failures: 0, stop: false, message: '' });
    (async () => {
      for (const address of queue) {
        if (search.stop) break;
        if (state.saved.places[address]) {
          search.done++;
          continue;
        }
        try {
          const place = await locate(address, regionOf.get(address), fallbackSido);
          search.failures = 0;
          if (place) {
            state.saved.places[address] = { ...place, lat: round6(place.lat), lng: round6(place.lng) };
            if (place.source === 'approx') search.approx++;
            else search.found++;
          } else {
            state.saved.notFound[address] = new Date().toISOString();
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
      if (!search.message) {
        search.message = search.stop
          ? '멈췄습니다.'
          : `끝났습니다. 주소로 ${search.found}곳, 시군 중심(대략)으로 ${search.approx}곳을 찾았습니다.`;
      }
      await flush().catch(() => {});
    })();
    return status();
  }

  function stopSearch() {
    search.stop = true;
    return status();
  }

  function retryNotFound() {
    state.saved.notFound = {};
    scheduleSave();
    return status();
  }

  return { ready, load, status, list, setLocation, clearLocation, saveUpload, startSearch, stopSearch, retryNotFound, flush };
}

module.exports = { createFestivals, readFestivals, addressQueries, cityQuery, expandSido, sidoOf, isFestivalHeader };
