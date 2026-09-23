'use strict';

// 실제 공공데이터포털 대신 가짜 상가정보 API / Nominatim 서버를 띄워서 로컬 서버를 검사한다.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer, normalizeServiceKey, parseStorePage, cleanPastedKey, upsertServiceKey } = require('../server.js');

const SERVICE_KEY = 'test+key/abc==';
const LARGE = [
  ['I2', '음식', 'I201', '한식', 'I20101', '백반/한정식'],
  ['G2', '소매', 'G204', '종합 소매', 'G20405', '편의점'],
  ['P1', '교육', 'P105', '일반 교육', 'P10501', '입시·교과학원'],
];

let upstream;
let upstreamUrl;
let upstreamMode = 'ok';
let upstreamTotal = 2500;
const upstreamRequests = [];

function makeItem(i, cx, cy) {
  const [lc, ln, mc, mn, sc, sn] = LARGE[i % LARGE.length];
  return {
    bizesId: `MA${String(i).padStart(10, '0')}`,
    bizesNm: `가게${i}`,
    brchNm: i % 7 === 0 ? '역삼점' : '',
    indsLclsCd: lc, indsLclsNm: ln,
    indsMclsCd: mc, indsMclsNm: mn,
    indsSclsCd: sc, indsSclsNm: sn,
    rdnmAdr: `서울특별시 강남구 테헤란로 ${i}`,
    lnoAdr: `서울특별시 강남구 역삼동 ${i}`,
    flrNo: '1',
    lon: cx + (i % 50) * 0.0001,
    lat: cy + Math.floor(i / 50) * 0.0001,
  };
}

function handleUpstream(req, res) {
  const url = new URL(req.url, 'http://x');
  upstreamRequests.push({ path: url.pathname, params: url.searchParams, headers: req.headers });

  if (url.pathname === '/search') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([
      { display_name: '세종대로, 태평로1가, 중구, 서울특별시', lat: '37.5662', lon: '126.9779' },
      { display_name: '이상한 결과', lat: 'x', lon: 'y' },
    ]));
    return;
  }

  if (upstreamMode === 'key-error') {
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end('<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg>' +
      '<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode>' +
      '</cmmMsgHeader></OpenAPI_ServiceResponse>');
    return;
  }
  if (upstreamMode === 'nodata') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ header: { resultCode: '03', resultMsg: 'NODATA_ERROR' } }));
    return;
  }

  const pageNo = Number(url.searchParams.get('pageNo'));
  const numOfRows = Number(url.searchParams.get('numOfRows'));
  const cx = Number(url.searchParams.get('cx'));
  const cy = Number(url.searchParams.get('cy'));
  const items = [];
  for (let i = (pageNo - 1) * numOfRows; i < Math.min(pageNo * numOfRows, upstreamTotal); i++) {
    items.push(makeItem(i, cx, cy));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    header: { description: '소상공인시장진흥공단 주요상권', stdrYm: '202506', resultCode: '00', resultMsg: 'NORMAL SERVICE' },
    body: { items, numOfRows, pageNo, totalCount: upstreamTotal },
  }));
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

async function startApp(overrides = {}) {
  const server = createServer({
    serviceKey: SERVICE_KEY,
    maxPages: 10,
    sdscBaseUrl: upstreamUrl,
    nominatimUrl: `${upstreamUrl}/search`,
    ...overrides,
  });
  const base = await listen(server);
  return { base, close: () => new Promise((r) => server.close(r)) };
}

// fetch는 경로의 ".."를 정리해 버리므로, 날것 그대로의 경로를 보낼 때 쓴다.
function rawGet(base, rawPath) {
  return new Promise((resolve, reject) => {
    http.get(`${base}${rawPath}`, { path: rawPath }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

before(async () => {
  upstream = http.createServer(handleUpstream);
  upstreamUrl = await listen(upstream);
});

after(() => new Promise((r) => upstream.close(r)));

test('Encoding 키를 넣어도 Decoding 키로 맞춘다', () => {
  assert.equal(normalizeServiceKey('test%2Bkey%2Fabc%3D%3D'), SERVICE_KEY);
  assert.equal(normalizeServiceKey(`  ${SERVICE_KEY}\n`), SERVICE_KEY);
  assert.equal(normalizeServiceKey(''), '');
});

test('붙여 넣은 인증키에서 변수 이름·따옴표·주석 기호를 걷어 낸다', () => {
  const key = 'c1dc3d090a0b6bc24d26265be5a1e07ce4c50a358bf8fa285872a3e8e4fc65f1';
  for (const pasted of [key, ` ${key} `, `DATA_GO_KR_SERVICE_KEY=${key}`, `# DATA_GO_KR_SERVICE_KEY= ${key}`, `DATA_GO_KR_SERVICE_KEY ${key}`, `"${key}"`]) {
    assert.equal(cleanPastedKey(pasted), key, pasted);
  }
  assert.equal(cleanPastedKey(''), '');
});

test('.env에 인증키 줄을 넣거나 바꾸고 나머지 줄은 그대로 둔다', () => {
  assert.equal(upsertServiceKey('', 'k1'), 'DATA_GO_KR_SERVICE_KEY=k1\n');
  assert.equal(upsertServiceKey('# 설명\nDATA_GO_KR_SERVICE_KEY=\n# PORT=3000\n', 'k$&2'), '# 설명\nDATA_GO_KR_SERVICE_KEY=k$&2\n# PORT=3000\n');
  assert.equal(upsertServiceKey('PORT=4000\n', 'k3'), 'DATA_GO_KR_SERVICE_KEY=k3\nPORT=4000\n');
});

test('item이 하나뿐이거나 {item: [...]} 형태여도 읽는다', () => {
  const one = parseStorePage(JSON.stringify({ header: { resultCode: '00' }, body: { items: { item: { bizesId: 'a' } }, totalCount: 1 } }), 200);
  assert.deepEqual(one.items, [{ bizesId: 'a' }]);
  const wrapped = parseStorePage(JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: [{ bizesId: 'b' }], totalCount: 1 } } }), 200);
  assert.deepEqual(wrapped.items, [{ bizesId: 'b' }]);
});

test('여러 페이지를 모두 불러오고, 키는 응답에 넣지 않는다', async () => {
  upstreamMode = 'ok';
  upstreamTotal = 2500;
  upstreamRequests.length = 0;
  const app = await startApp();
  try {
    const res = await fetch(`${app.base}/api/stores?lat=37.5&lng=127.03&radius=500`);
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.ok(!text.includes('test+key') && !text.includes('test%2Bkey'), '응답에 인증키가 들어 있으면 안 된다');

    const data = JSON.parse(text);
    assert.equal(data.stores.length, 2500);
    assert.equal(data.totalCount, 2500);
    assert.equal(data.truncated, false);
    assert.equal(data.stdrYm, '202506');
    assert.equal(data.radius, 500);
    assert.deepEqual(data.stores[0], {
      id: 'MA0000000000', name: '가게0', branch: '역삼점',
      largeCode: 'I2', large: '음식', mediumCode: 'I201', medium: '한식', smallCode: 'I20101', small: '백반/한정식',
      address: '서울특별시 강남구 테헤란로 0', floor: '1', lat: 37.5, lng: 127.03,
    });

    const calls = upstreamRequests.filter((r) => r.path === '/storeListInRadius');
    assert.deepEqual(calls.map((c) => c.params.get('pageNo')).sort(), ['1', '2', '3']);
    for (const c of calls) {
      assert.equal(c.params.get('serviceKey'), SERVICE_KEY);
      assert.equal(c.params.get('numOfRows'), '1000');
      assert.equal(c.params.get('radius'), '500');
      assert.equal(c.params.get('cx'), '127.03');
      assert.equal(c.params.get('cy'), '37.5');
      assert.equal(c.params.get('type'), 'json');
    }

    // 같은 조회는 캐시에서 준다.
    upstreamRequests.length = 0;
    await (await fetch(`${app.base}/api/stores?lat=37.5&lng=127.03&radius=500`)).json();
    assert.equal(upstreamRequests.length, 0);
  } finally {
    await app.close();
  }
});

test('MAX_PAGES를 넘으면 잘라서 주고 truncated로 알린다', async () => {
  upstreamMode = 'ok';
  upstreamTotal = 2500;
  const app = await startApp({ maxPages: 2 });
  try {
    const data = await (await fetch(`${app.base}/api/stores?lat=37.51&lng=127.03&radius=500`)).json();
    assert.equal(data.stores.length, 2000);
    assert.equal(data.totalCount, 2500);
    assert.equal(data.truncated, true);
  } finally {
    await app.close();
  }
});

test('반경은 API 한도(2km) 안으로 맞춘다', async () => {
  upstreamMode = 'ok';
  upstreamTotal = 10;
  upstreamRequests.length = 0;
  const app = await startApp();
  try {
    const data = await (await fetch(`${app.base}/api/stores?lat=37.52&lng=127.03&radius=99999`)).json();
    assert.equal(data.radius, 2000);
    assert.equal(upstreamRequests[0].params.get('radius'), '2000');
  } finally {
    await app.close();
  }
});

test('가게가 없으면 빈 목록을 준다', async () => {
  upstreamMode = 'nodata';
  const app = await startApp();
  try {
    const res = await fetch(`${app.base}/api/stores?lat=35.1&lng=129.0&radius=100`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.stores, []);
    assert.equal(data.totalCount, 0);
  } finally {
    await app.close();
  }
});

test('인증키 오류(XML 응답)는 알아볼 수 있는 메시지로 바꾼다', async () => {
  upstreamMode = 'key-error';
  const app = await startApp();
  try {
    const res = await fetch(`${app.base}/api/stores?lat=35.2&lng=129.0&radius=100`);
    const text = await res.text();
    assert.equal(res.status, 502);
    assert.match(JSON.parse(text).error, /등록되지 않은 인증키/);
    assert.ok(!text.includes('test+key'));
  } finally {
    await app.close();
  }
});

test('키가 없거나 좌표가 이상하면 상가정보 API를 부르지 않는다', async () => {
  upstreamRequests.length = 0;
  const noKey = await startApp({ serviceKey: '' });
  try {
    const res = await fetch(`${noKey.base}/api/stores?lat=37.5&lng=127&radius=500`);
    assert.equal(res.status, 503);
    const config = await (await fetch(`${noKey.base}/api/config`)).json();
    assert.equal(config.hasKey, false);
  } finally {
    await noKey.close();
  }

  const app = await startApp();
  try {
    for (const qs of ['lat=abc&lng=127', 'lat=37.5', 'lat=40.7&lng=-74', 'lat=&lng=']) {
      const res = await fetch(`${app.base}/api/stores?${qs}`);
      assert.equal(res.status, 400, qs);
    }
    const config = await (await fetch(`${app.base}/api/config`)).json();
    assert.deepEqual(config, { hasKey: true, maxRadius: 2000, maxStores: 10000 });
  } finally {
    await app.close();
  }
  assert.equal(upstreamRequests.filter((r) => r.path === '/storeListInRadius').length, 0);
});

test('주소 검색은 Nominatim 결과를 좌표 목록으로 바꾼다', async () => {
  upstreamRequests.length = 0;
  const app = await startApp();
  try {
    const res = await fetch(`${app.base}/api/geocode?q=${encodeURIComponent('서울 중구 세종대로 110')}`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [{ label: '세종대로, 태평로1가, 중구, 서울특별시', lat: 37.5662, lng: 126.9779 }]);
    const call = upstreamRequests.find((r) => r.path === '/search');
    assert.equal(call.params.get('q'), '서울 중구 세종대로 110');
    assert.equal(call.params.get('countrycodes'), 'kr');
    assert.match(call.headers['user-agent'], /lifemomo-store-map/);

    assert.equal((await fetch(`${app.base}/api/geocode?q=`)).status, 400);
  } finally {
    await app.close();
  }
});

test('화면 파일만 내려주고 public 밖의 파일은 주지 않는다', async () => {
  const app = await startApp();
  try {
    const index = await fetch(`${app.base}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.match(await index.text(), /반경 상가 지도/);

    const js = await fetch(`${app.base}/app.js`);
    assert.match(js.headers.get('content-type'), /javascript/);
    assert.ok(!(await js.text()).includes('DATA_GO_KR_SERVICE_KEY'));

    for (const p of ['/../server.js', '/..%2fserver.js', '/%2e%2e/%2e%2e/server.js', '/..%2f.env']) {
      const res = await rawGet(app.base, p);
      assert.ok(res.status === 403 || res.status === 404, `${p} → ${res.status}`);
      assert.ok(!res.body.includes('createServer'), p);
    }
    assert.equal((await fetch(`${app.base}/api/nope`)).status, 404);
    assert.equal((await fetch(`${app.base}/api/config`, { method: 'POST' })).status, 405);
  } finally {
    await app.close();
  }
});
