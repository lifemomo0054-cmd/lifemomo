'use strict';

// 반경 상가 지도 — 로컬 서버
//
// - public/ 폴더의 화면 파일을 내려준다.
// - /api/stores  : 공공데이터포털 상가(상권)정보 API(반경내 상가업소 조회)를 대신 호출한다.
// - /api/geocode : 주소 → 좌표 변환(OpenStreetMap Nominatim, 키 불필요)을 대신 호출한다.
//
// 인증키는 이 서버에서만 읽고 쓴다. 브라우저로 가는 응답이나 로그에는 절대 넣지 않는다.

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROWS_PER_PAGE = 1000; // 상가정보 API가 한 번에 주는 최대 건수
const MAX_RADIUS_M = 2000; // 상가정보 API가 허용하는 최대 반경(m)
const MIN_RADIUS_M = 50;
const DEFAULT_RADIUS_M = 500;
const PAGE_CONCURRENCY = 3;
const UPSTREAM_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 50;
const NOMINATIM_INTERVAL_MS = 1100; // Nominatim 이용 정책: 초당 1회 이하
const PUBLIC_DIR = path.join(__dirname, 'public');
const USER_AGENT = 'lifemomo-store-map/1.0 (+https://github.com/lifemomo0054-cmd/lifemomo)';

// 공공데이터포털 게이트웨이/상가정보 API의 오류 코드 → 화면에 보여줄 설명
const UPSTREAM_ERRORS = {
  SERVICE_KEY_IS_NOT_REGISTERED_ERROR:
    '등록되지 않은 인증키입니다. .env의 키를 확인하세요. 발급 직후라면 활성화까지 1~2시간 걸릴 수 있습니다.',
  SERVICE_ACCESS_DENIED_ERROR:
    '이 인증키로는 상가(상권)정보 API를 쓸 수 없습니다. 공공데이터포털에서 활용신청이 승인됐는지 확인하세요.',
  LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR:
    '오늘 쓸 수 있는 API 호출 횟수를 모두 썼습니다. 내일 다시 시도하세요.',
  DEADLINE_HAS_EXPIRED_ERROR: '인증키의 활용기간이 끝났습니다. 공공데이터포털에서 연장 신청을 하세요.',
  UNREGISTERED_IP_ERROR: '등록되지 않은 IP에서 호출했습니다. 공공데이터포털의 IP 설정을 확인하세요.',
  INVALID_REQUEST_PARAMETER_ERROR: '상가정보 API가 요청 값을 받아들이지 않았습니다.',
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

class ApiError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// 포털은 같은 키를 "Encoding"(%2B 등으로 인코딩됨)과 "Decoding" 두 형태로 준다.
// 어느 쪽을 넣어도 되도록 디코딩된 형태로 맞추고, 요청할 때 한 번만 인코딩한다.
function normalizeServiceKey(raw) {
  const key = (raw || '').trim();
  if (/%[0-9A-Fa-f]{2}/.test(key)) {
    try {
      return decodeURIComponent(key);
    } catch {
      return key;
    }
  }
  return key;
}

function readConfigFromEnv(env = process.env) {
  return {
    serviceKey: normalizeServiceKey(env.DATA_GO_KR_SERVICE_KEY),
    maxPages: clampInt(env.MAX_PAGES, 1, 50, 10),
    sdscBaseUrl: env.SDSC_BASE_URL || 'https://apis.data.go.kr/B553077/api/open/sdsc2',
    nominatimUrl: env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search',
  };
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseCoord(value, min, max) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function matchTag(text, tag) {
  const m = text.match(new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`));
  return m ? m[1] : '';
}

function describeUpstreamError(code) {
  return UPSTREAM_ERRORS[code] || `상가정보 API 오류: ${code}`;
}

// 상가정보 API 응답 한 페이지를 { totalCount, stdrYm, items } 로 바꾼다.
function parseStorePage(text, httpStatus) {
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // 인증키 오류·트래픽 초과 같은 게이트웨이 오류는 type=json이어도 XML로 온다.
  }
  if (!data || typeof data !== 'object') {
    const code = matchTag(text, 'returnAuthMsg') || matchTag(text, 'resultMsg') || matchTag(text, 'errMsg');
    throw new ApiError(502, describeUpstreamError(code || `HTTP ${httpStatus}`), code || `HTTP ${httpStatus}`);
  }

  const root = data.response || data;
  const header = root.header || {};
  const resultCode = String(header.resultCode ?? '00');
  const resultMsg = String(header.resultMsg || '');
  if (resultCode === '03' || /NODATA/i.test(resultMsg)) {
    return { totalCount: 0, stdrYm: header.stdrYm || '', items: [] };
  }
  if (resultCode !== '00') {
    const code = resultMsg || `resultCode ${resultCode}`;
    throw new ApiError(502, describeUpstreamError(code), code);
  }

  const body = root.body || {};
  let items = body.items ?? [];
  if (!Array.isArray(items)) items = items.item ?? [];
  if (!Array.isArray(items)) items = [items];
  return { totalCount: Number(body.totalCount) || 0, stdrYm: header.stdrYm || '', items };
}

// 화면에 필요한 값만 추려서 보낸다.
function toStore(item) {
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    id: item.bizesId || '',
    name: item.bizesNm || '',
    branch: item.brchNm || '',
    largeCode: item.indsLclsCd || '',
    large: item.indsLclsNm || '',
    mediumCode: item.indsMclsCd || '',
    medium: item.indsMclsNm || '',
    smallCode: item.indsSclsCd || '',
    small: item.indsSclsNm || '',
    address: item.rdnmAdr || item.lnoAdr || '',
    roadAddress: item.rdnmAdr || '',
    jibunAddress: item.lnoAdr || '',
    building: item.bldNm || '',
    sido: item.ctprvnNm || '',
    sigungu: item.signguNm || '',
    adong: item.adongNm || '',
    ldong: item.ldongNm || '',
    floor: item.flrNo == null ? '' : String(item.flrNo),
    lat,
    lng,
  };
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createServer(config) {
  const storeCache = new Map();
  const geocodeCache = new Map();
  let nominatimQueue = Promise.resolve();
  let lastNominatimAt = 0;

  // 같은 요청이 짧은 시간에 다시 오면 API를 또 부르지 않는다(일일 호출 한도 절약).
  function memo(cache, key, fn) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;
    const promise = fn();
    cache.set(key, { at: Date.now(), promise });
    promise.catch(() => {
      if (cache.get(key)?.promise === promise) cache.delete(key);
    });
    if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
    return promise;
  }

  async function fetchStorePage(query, pageNo, attempt = 1) {
    const params = new URLSearchParams({
      serviceKey: config.serviceKey,
      pageNo: String(pageNo),
      numOfRows: String(ROWS_PER_PAGE),
      radius: String(query.radius),
      cx: String(query.lng),
      cy: String(query.lat),
      type: 'json',
    });
    let res;
    let text;
    try {
      res = await fetch(`${config.sdscBaseUrl}/storeListInRadius?${params}`, {
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      text = await res.text();
    } catch (err) {
      // 요청 URL에는 인증키가 들어 있으므로 원인 메시지만 남긴다.
      if (attempt < 2) return fetchStorePage(query, pageNo, attempt + 1);
      throw new ApiError(502, '상가정보 API에 연결하지 못했습니다. 잠시 후 다시 시도하세요.', err.cause?.message || err.message);
    }
    if (res.status >= 500 && attempt < 2) return fetchStorePage(query, pageNo, attempt + 1);
    return parseStorePage(text, res.status);
  }

  async function fetchStoresInRadius(query) {
    const first = await fetchStorePage(query, 1);
    const availablePages = Math.ceil(first.totalCount / ROWS_PER_PAGE);
    const pagesToLoad = Math.min(availablePages, config.maxPages);
    const restPages = [];
    for (let p = 2; p <= pagesToLoad; p++) restPages.push(p);
    const rest = await mapLimit(restPages, PAGE_CONCURRENCY, (p) => fetchStorePage(query, p));

    const byId = new Map();
    for (const page of [first, ...rest]) {
      for (const item of page.items) {
        const store = toStore(item);
        if (store) byId.set(store.id || Symbol('no-id'), store);
      }
    }
    return {
      center: { lat: query.lat, lng: query.lng },
      radius: query.radius,
      totalCount: first.totalCount,
      stdrYm: first.stdrYm,
      truncated: availablePages > pagesToLoad,
      stores: [...byId.values()],
    };
  }

  function handleStores(params) {
    if (!config.serviceKey) {
      throw new ApiError(503, '서버에 인증키가 없습니다. .env 파일에 DATA_GO_KR_SERVICE_KEY를 넣고 서버를 다시 켜 주세요.');
    }
    const lat = parseCoord(params.get('lat'), 32, 39.5);
    const lng = parseCoord(params.get('lng'), 124, 132);
    if (lat == null || lng == null) {
      throw new ApiError(400, '대한민국 안의 위치만 조회할 수 있습니다.');
    }
    const query = {
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      radius: clampInt(params.get('radius'), MIN_RADIUS_M, MAX_RADIUS_M, DEFAULT_RADIUS_M),
    };
    const key = `${query.lat},${query.lng},${query.radius}`;
    return memo(storeCache, key, () => fetchStoresInRadius(query));
  }

  function throttleNominatim(fn) {
    const run = nominatimQueue.then(async () => {
      const wait = lastNominatimAt + NOMINATIM_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastNominatimAt = Date.now();
      return fn();
    });
    nominatimQueue = run.catch(() => {});
    return run;
  }

  async function geocode(q) {
    const params = new URLSearchParams({
      q,
      format: 'jsonv2',
      countrycodes: 'kr',
      'accept-language': 'ko',
      limit: '5',
    });
    let res;
    let list;
    try {
      res = await fetch(`${config.nominatimUrl}?${params}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      list = res.ok ? await res.json() : null;
    } catch (err) {
      throw new ApiError(502, '주소 검색 서비스에 연결하지 못했습니다.', err.cause?.message || err.message);
    }
    if (!Array.isArray(list)) throw new ApiError(502, `주소 검색 서비스 오류 (HTTP ${res.status})`);
    return list
      .map((p) => ({ label: p.display_name || '', lat: Number(p.lat), lng: Number(p.lon) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  }

  function handleGeocode(params) {
    const q = (params.get('q') || '').trim().slice(0, 200);
    if (!q) throw new ApiError(400, '검색할 주소를 입력하세요.');
    return memo(geocodeCache, q, () => throttleNominatim(() => geocode(q)));
  }

  async function serveStatic(pathname, res) {
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return sendText(res, 400, 'Bad Request');
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(PUBLIC_DIR, path.normalize(rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendText(res, 403, 'Forbidden');
    let data;
    try {
      data = await fs.readFile(file);
    } catch {
      return sendText(res, 404, 'Not Found');
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'GET 요청만 받습니다.' });
      switch (url.pathname) {
        case '/api/config':
          return sendJson(res, 200, {
            hasKey: Boolean(config.serviceKey),
            maxRadius: MAX_RADIUS_M,
            maxStores: config.maxPages * ROWS_PER_PAGE,
          });
        case '/api/stores':
          return sendJson(res, 200, await handleStores(url.searchParams));
        case '/api/geocode':
          return sendJson(res, 200, await handleGeocode(url.searchParams));
      }
      if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: '없는 API입니다.' });
      return await serveStatic(url.pathname, res);
    } catch (err) {
      const known = err instanceof ApiError;
      const status = known ? err.status : 500;
      if (status >= 500) console.error(`[${url.pathname}] ${err.message}${err.detail ? ` (${err.detail})` : ''}`);
      if (!res.headersSent) sendJson(res, status, { error: known ? err.message : '서버 오류가 발생했습니다.' });
    }
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

// 붙여 넣은 값에 "DATA_GO_KR_SERVICE_KEY=", 따옴표, 주석 기호가 섞여 있어도 키만 남긴다.
function cleanPastedKey(input) {
  return String(input || '')
    .trim()
    .replace(/^#?\s*DATA_GO_KR_SERVICE_KEY\s*=?\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

// .env 내용에서 인증키 줄을 바꾸거나, 없으면 맨 앞에 넣는다.
function upsertServiceKey(envText, key) {
  const line = `DATA_GO_KR_SERVICE_KEY=${key}`;
  const pattern = /^DATA_GO_KR_SERVICE_KEY=.*$/m;
  return pattern.test(envText) ? envText.replace(pattern, () => line) : `${line}\n${envText}`;
}

// 키 없이 켜면 터미널에서 물어보고 .env에 저장한다(처음 한 번만).
async function askAndSaveServiceKey(envPath) {
  const readline = require('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let key;
  try {
    console.log('공공데이터포털 인증키가 아직 없습니다. (data.go.kr > 마이페이지 > 일반 인증키)');
    key = cleanPastedKey(await rl.question('인증키를 붙여 넣고 Enter를 누르세요: '));
  } finally {
    rl.close();
  }
  if (!key) return '';
  const current = await fs.readFile(envPath, 'utf8').catch(() => '');
  await fs.writeFile(envPath, upsertServiceKey(current, key));
  console.log('인증키를 .env에 저장했습니다. 다음부터는 묻지 않습니다.');
  return key;
}

function openBrowser(url) {
  const { spawn } = require('node:child_process');
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]]
        : ['xdg-open', [url]];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {}); // 브라우저를 못 열어도 주소는 터미널에 찍혀 있다.
  child.unref();
}

async function main() {
  if (typeof process.loadEnvFile !== 'function') {
    console.error(`Node.js 20.12 이상이 필요합니다(지금 ${process.version}). https://nodejs.org 에서 LTS 버전을 설치하세요.`);
    process.exit(1);
  }
  const envPath = path.join(__dirname, '.env');
  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // .env가 없으면 이미 설정된 환경변수만 쓴다.
  }
  const config = readConfigFromEnv();
  if (!config.serviceKey && process.stdin.isTTY) {
    config.serviceKey = normalizeServiceKey(await askAndSaveServiceKey(envPath));
  }
  const port = clampInt(process.env.PORT, 1, 65535, 3000);
  // 기본은 이 컴퓨터에서만 접속 가능. 다른 기기에 열면 그 사람들도 내 키의 호출 한도를 쓰게 된다.
  const host = process.env.HOST || '127.0.0.1';
  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;

  const server = createServer(config);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`포트 ${port}를 이미 다른 프로그램이 쓰고 있습니다. 서버가 이미 켜져 있다면 브라우저에서 ${url} 을 여세요.`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(port, host, () => {
    console.log(`반경 상가 지도: ${url}`);
    console.log('끄려면 이 창을 닫거나 Ctrl+C를 누르세요.');
    if (!config.serviceKey) {
      console.warn('[경고] DATA_GO_KR_SERVICE_KEY가 없습니다. .env.example을 복사해 .env를 만들고 인증키를 넣으세요.');
    }
    if (process.argv.includes('--open')) openBrowser(url);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  createServer,
  normalizeServiceKey,
  parseStorePage,
  toStore,
  readConfigFromEnv,
  cleanPastedKey,
  upsertServiceKey,
};
