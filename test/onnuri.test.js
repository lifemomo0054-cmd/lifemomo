'use strict';

// 온누리상품권 가맹점 파일 읽기, 시장 위치 맞추기, 반경·영역 조회, 서버 API를 검사한다.
// fixtures/traditional-markets-cp949.csv 는 전국전통시장표준데이터 모양의 작은 CP949 파일이다(파이썬으로 만듦).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOnnuri, parseCsv, decodeCsv, detectKind, readMarketsTable, matchStandard, normName } = require('../onnuri.js');
const { createServer } = require('../server.js');

const STANDARD_CP949 = fs.readFileSync(path.join(__dirname, 'fixtures', 'traditional-markets-cp949.csv'));

// 실제 파일과 같은 머리글, UTF-8 BOM
const STORES_CSV = Buffer.from(
  '﻿가맹점명,소속 시장명(또는 상점가),소재지,취급품목,지류형 가맹 여부,디지털형 가맹 여부,가맹 등록년도\r\n' +
    '화란커피숍,김천중앙시장,경북,커피 디저트,Y,Y,2025\r\n' +
    '"김천, 옷가게",김천중앙시장,경북,의류,Y,N,2024\r\n' +
    '신발나라,김천중앙시장,경북,,Y,Y,2023\r\n' +
    '남대문상회,남대문시장,서울,의류,Y,Y,2010\r\n' +
    '남대문잡화,남대문시장,서울,잡화,Y,Y,2011\r\n' +
    '경주상회,중앙시장,경북,농산물,Y,Y,2020\r\n' +
    '평화의류,평화시장,부산,의류,Y,Y,2019\r\n' +
    '골목빵집,노량진수산시장골목형상점가,서울,빵,Y,Y,2025\r\n',
  'utf8',
);

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'onnuri-'));

async function loaded({ searchPlace = async () => null, withStandard = true } = {}) {
  const dir = tempDir();
  const onnuri = createOnnuri({ dataDir: dir, searchPlace, log: { error() {} } });
  await onnuri.ready();
  await onnuri.saveUpload(STORES_CSV, '온누리상품권 가맹점 현황_20260731.csv');
  if (withStandard) await onnuri.saveUpload(STANDARD_CP949, '전국전통시장표준데이터.csv');
  return { onnuri, dir };
}

test('CSV: BOM, 따옴표, 칸 안 쉼표·줄바꿈, CRLF, 빈 줄', () => {
  const text = decodeCsv(Buffer.from('﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n\r\n1,,3\n', 'utf8'));
  assert.deepEqual(parseCsv(text), [
    ['a', 'b', 'c'],
    ['x, y', 'say "hi"', 'line1\nline2'],
    ['1', '', '3'],
  ]);
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']], '마지막 줄바꿈이 없어도 된다');
});

test('CP949 파일도 읽고, 머리글로 파일 종류를 알아낸다', () => {
  const rows = parseCsv(decodeCsv(STANDARD_CP949));
  assert.equal(detectKind(rows[0]), 'markets');
  assert.equal(detectKind(parseCsv(decodeCsv(STORES_CSV))[0]), 'stores');
  assert.equal(detectKind(['이름', '주소']), null);
  const markets = readMarketsTable(rows);
  assert.equal(markets.length, 6, '좌표 없는 줄은 뺀다');
  assert.deepEqual(markets[0], { name: '남대문시장', address: '서울특별시 중구 남대문시장4길 21, 1층', lat: 37.5591, lng: 126.9776 });
  assert.equal(markets[5].name, '"따옴표"시장');
});

test('표준데이터와 시장 이름 맞추기: 하나로만 맞을 때만 고른다', () => {
  const index = new Map();
  for (const row of readMarketsTable(parseCsv(decodeCsv(STANDARD_CP949)))) {
    const key = normName(row.name);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
  assert.equal(matchStandard({ name: '남대문시장', sido: '서울' }, index).lat, 37.5591);
  assert.equal(matchStandard({ name: '남대문 시장', sido: '서울' }, index).lat, 37.5591, '띄어쓰기는 무시');
  assert.equal(matchStandard({ name: '중앙시장', sido: '경북' }, index), null, '경북에 중앙시장이 둘이라 고르지 않는다');
  assert.equal(matchStandard({ name: '김천중앙시장', sido: '경북' }, index).lat, 36.1233, '"김천"+"중앙시장" → 김천시 주소의 중앙시장');
  assert.equal(matchStandard({ name: '평화시장', sido: '부산' }, index).lat, 35.138, '같은 이름이라도 시도로 가른다');
  assert.equal(matchStandard({ name: '남대문시장', sido: '부산' }, index), null);
});

test('파일을 올리면 시장별로 묶고, 표준데이터로 위치를 채운다', async () => {
  const { onnuri, dir } = await loaded();
  const st = onnuri.status();
  assert.equal(st.loaded, true);
  assert.equal(st.stores, 8);
  assert.equal(st.markets, 5);
  assert.equal(st.dataDate, '20260731');
  assert.equal(st.fileName, '온누리상품권 가맹점 현황_20260731.csv');
  assert.deepEqual(st.bySource, { manual: 0, standard: 3, search: 0 }); // 김천중앙·남대문·부산 평화
  assert.deepEqual(fs.readdirSync(dir).sort(), ['onnuri-meta.json', 'onnuri-stores.csv', 'traditional-markets.csv']);

  const unlocated = onnuri.listMarkets({ located: 'no' }).map((m) => m.name).sort();
  assert.deepEqual(unlocated, ['노량진수산시장골목형상점가', '중앙시장']);
  assert.equal(onnuri.listMarkets({ q: '김천' })[0].count, 3);
});

test('반경·영역 안의 시장과 그 가맹점을 돌려준다', async () => {
  const { onnuri } = await loaded();
  const r = onnuri.queryCircle({ lat: 36.1225, lng: 128.114, radius: 500 });
  assert.equal(r.kind, 'radius');
  assert.equal(r.source, 'onnuri');
  assert.deepEqual(r.markets.map((m) => m.name), ['김천중앙시장']);
  assert.equal(r.stores.length, 3);
  assert.deepEqual(r.stores[1], {
    name: '김천, 옷가게', marketId: '경북|김천중앙시장', market: '김천중앙시장', sido: '경북', item: '의류', paper: true, digital: false, year: '2024',
  });
  assert.equal(onnuri.queryCircle({ lat: 36.1225, lng: 128.114, radius: 50 }).stores.length, 0);

  const box = [[37.55, 126.97], [37.55, 127.02], [37.575, 127.02], [37.575, 126.97]];
  const area = onnuri.queryPolygon(box);
  assert.deepEqual(area.markets.map((m) => m.name), ['남대문시장']);
  assert.equal(area.stores.length, 2);
  assert.ok(area.areaM2 > 0);
});

test('직접 찍은 위치가 가장 우선이고, 다시 켜도 남아 있다', async () => {
  const { onnuri, dir } = await loaded();
  const id = '경북|중앙시장';
  assert.equal(onnuri.setLocation(id, 35.84, 129.208).locSource, 'manual');
  assert.equal(onnuri.setLocation('경북|김천중앙시장', 36.2, 128.2).locSource, 'manual', '표준데이터보다 우선');
  await onnuri.flush();

  const again = createOnnuri({ dataDir: dir, searchPlace: async () => null });
  await again.ready();
  assert.deepEqual(again.status().bySource, { manual: 2, standard: 2, search: 0 });
  assert.equal(again.clearLocation('경북|김천중앙시장').locSource, 'standard', '지우면 표준데이터 위치로 돌아간다');
});

test('못 찾은 시장은 이름으로 검색한다: 시도 범위 안에서, 안 되면 꼬리를 떼고 다시', async () => {
  const calls = [];
  const searchPlace = async (q, bbox) => {
    calls.push({ q, bbox });
    return q === '노량진수산시장' ? { lat: 37.513, lng: 126.94, label: '노량진수산시장, 동작구' } : null;
  };
  const { onnuri } = await loaded({ searchPlace });
  onnuri.startSearch('서울');
  while (onnuri.status().search.running) await new Promise((r) => setTimeout(r, 10));

  assert.deepEqual(calls.map((c) => c.q), ['노량진수산시장골목형상점가', '노량진수산시장']);
  assert.deepEqual(calls[0].bbox, [126.76, 37.41, 127.19, 37.72], '서울 범위 안에서만 찾는다');
  const st = onnuri.status();
  assert.equal(st.search.found, 1);
  assert.equal(st.bySource.search, 1);
  assert.match(st.search.message, /1곳/);

  // 경북 중앙시장은 못 찾음 → 다음 검색에서 건너뛴다
  calls.length = 0;
  onnuri.startSearch('경북');
  while (onnuri.status().search.running) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls.map((c) => c.q), ['중앙시장']);
  assert.equal(onnuri.status().notFound, 1);
  calls.length = 0;
  onnuri.startSearch('경북');
  while (onnuri.status().search.running) await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.length, 0);
  onnuri.retryNotFound('경북');
  assert.equal(onnuri.status().notFound, 0);
});

test('주소 검색 서비스가 계속 안 되면 멈추고 알려 준다', async () => {
  const { onnuri } = await loaded({ withStandard: false, searchPlace: async () => { throw new Error('connect ECONNREFUSED'); } });
  onnuri.startSearch('');
  while (onnuri.status().search.running) await new Promise((r) => setTimeout(r, 10));
  assert.match(onnuri.status().search.message, /연결되지 않아 멈췄습니다/);
});

test('서버 API: 올리기 → 상태 → 반경·영역 조회 → 위치 찍기', async () => {
  const dir = tempDir();
  const server = createServer({ serviceKey: 'k', maxPages: 1, sdscBaseUrl: 'http://127.0.0.1:9', nominatimUrl: 'http://127.0.0.1:9', dataDir: dir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body, type = 'application/json') =>
    fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': type }, body: type === 'application/json' ? JSON.stringify(body) : body });
  try {
    assert.equal((await (await fetch(`${base}/api/onnuri/status`)).json()).loaded, false);
    assert.equal((await fetch(`${base}/api/onnuri/stores?lat=36.12&lng=128.11&radius=500`)).status, 409, '파일 없으면 먼저 올리라고');

    assert.equal((await post('/api/onnuri/upload?name=x.csv', STORES_CSV, 'text/plain')).status, 415);
    const bad = await post('/api/onnuri/upload?name=x.csv', Buffer.from('이름,주소\n가,나\n'), 'application/octet-stream');
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /온누리 가맹점 파일/);

    const up = await post(`/api/onnuri/upload?name=${encodeURIComponent('가맹점_20260731.csv')}`, STORES_CSV, 'application/octet-stream');
    assert.equal(up.status, 200);
    assert.equal((await up.json()).kind, 'stores');
    await post('/api/onnuri/upload?name=std.csv', STANDARD_CP949, 'application/octet-stream');

    const circle = await (await fetch(`${base}/api/onnuri/stores?lat=37.5591&lng=126.9776&radius=300`)).json();
    assert.deepEqual(circle.markets.map((m) => m.name), ['남대문시장']);
    assert.equal(circle.stores.length, 2);

    const area = await (await post('/api/onnuri/stores/area', { points: [[36.12, 128.11], [36.12, 128.12], [36.13, 128.12], [36.13, 128.11]] })).json();
    assert.equal(area.stores.length, 3);

    const loc = await post('/api/onnuri/location', { id: '서울|노량진수산시장골목형상점가', lat: 37.513, lng: 126.94 });
    assert.equal((await loc.json()).locSource, 'manual');
    assert.equal((await post('/api/onnuri/location', { id: '없는|시장', lat: 37.5, lng: 127 })).status, 404);
    assert.equal((await post('/api/onnuri/location', { id: '서울|남대문시장', lat: 40.7, lng: -74 })).status, 400);

    const markets = await (await fetch(`${base}/api/onnuri/markets?located=no`)).json();
    assert.deepEqual(markets.map((m) => m.name), ['중앙시장']);
    assert.equal((await post('/api/onnuri/search', { action: 'jump' })).status, 400);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
