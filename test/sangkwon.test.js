'use strict';

// 전국 상권 현황(odcloud 오픈API): 페이지 넘기기, 인증키 오류, 캐시, CSV로 대신 쓰기를 가짜 odcloud 서버로 검사한다.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createServer } = require('../server.js');

const KEY = 'c1dc3d090a0b6bc24d26265be5a1e07ce4c50a358bf8fa285872a3e8e4fc65f1';
const SIDO = ['서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시', '세종특별자치시', '경기도', '강원특별자치도', '충청북도', '충청남도', '전북특별자치도', '전라남도', '경상북도', '경상남도', '제주특별자치도'];
const ROWS = SIDO.map((name, i) => ({ 시도명: name, 상권수: 100 + i, 골목상권: 50 + i, 조사연도: 2024 }));
const PAGE_SIZE = 7; // 가짜 서버는 perPage와 상관없이 7줄씩 준다 → 3쪽

let odcloud;
let odcloudUrl;
const calls = [];

before(async () => {
  odcloud = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    calls.push(url.searchParams);
    if (url.searchParams.get('serviceKey') !== KEY) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: -4, msg: '등록되지 않은 인증키 입니다.' }));
      return;
    }
    const page = Number(url.searchParams.get('page'));
    const data = ROWS.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ page, perPage: PAGE_SIZE, totalCount: ROWS.length, currentCount: data.length, matchCount: ROWS.length, data }));
  });
  await new Promise((r) => odcloud.listen(0, '127.0.0.1', r));
  odcloudUrl = `http://127.0.0.1:${odcloud.address().port}/api/15143727/v1/uddi:test`;
});

after(() => new Promise((r) => odcloud.close(r)));

async function startApp(serviceKey) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sangkwon-'));
  const server = createServer({ serviceKey, maxPages: 1, sdscBaseUrl: 'http://127.0.0.1:9', nominatimUrl: 'http://127.0.0.1:9', dataDir, sangkwonUrl: odcloudUrl });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

const upload = (base, body) =>
  fetch(`${base}/api/sangkwon/upload?name=${encodeURIComponent('전국상권현황.csv')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
  });

test('모든 쪽을 받아 열 순서 그대로 주고, 인증키는 응답에 넣지 않는다', async () => {
  calls.length = 0;
  const app = await startApp(KEY);
  try {
    const res = await fetch(`${app.base}/api/sangkwon`);
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.ok(!text.includes(KEY), '응답에 인증키가 있으면 안 된다');
    const data = JSON.parse(text);
    assert.equal(data.source, 'api');
    assert.deepEqual(data.columns, ['시도명', '상권수', '골목상권', '조사연도']);
    assert.equal(data.rows.length, 17);
    assert.deepEqual(data.rows[16], ROWS[16]);
    assert.deepEqual(calls.map((c) => c.get('page')), ['1', '2', '3']);
    assert.equal(calls[0].get('returnType'), 'JSON');

    // 한 시간 동안은 다시 부르지 않는다. refresh=1 이면 새로 받는다.
    calls.length = 0;
    await (await fetch(`${app.base}/api/sangkwon`)).json();
    assert.equal(calls.length, 0);
    await (await fetch(`${app.base}/api/sangkwon?refresh=1`)).json();
    assert.equal(calls.length, 3);
  } finally {
    await app.close();
  }
});

test('인증키가 승인 전이면 알아볼 수 있게 알려 준다', async () => {
  const app = await startApp('not-approved-key');
  try {
    const res = await fetch(`${app.base}/api/sangkwon`);
    assert.equal(res.status, 503);
    const { error } = await res.json();
    assert.match(error, /활용신청이 승인됐는지/);
    assert.match(error, /CSV 파일을 올려서/);
  } finally {
    await app.close();
  }
});

test('API를 못 쓰면 올린 CSV(CP949)를 대신 보여 주고, 왜 그런지도 알려 준다', async () => {
  const app = await startApp('not-approved-key');
  try {
    const bad = await upload(app.base, Buffer.from('하나뿐인 열\n'));
    assert.equal(bad.status, 400);

    // "시도,상권수,골목상권" CP949 바이트 (파이썬으로 만든 값)
    const cp949 = Buffer.from('bdc3b5b52cbbf3b1c7bcf62cb0f1b8f1bbf3b1c70d0abcadbfefc6afbab0bdc32c3132332c34350d0a', 'hex');
    const ok = await upload(app.base, cp949);
    assert.equal(ok.status, 200);

    const data = await (await fetch(`${app.base}/api/sangkwon`)).json();
    assert.equal(data.source, 'file');
    assert.equal(data.fileName, '전국상권현황.csv');
    assert.deepEqual(data.columns, ['시도', '상권수', '골목상권']);
    assert.deepEqual(data.rows, [{ 시도: '서울특별시', 상권수: '123', 골목상권: '45' }]);
    assert.match(data.warning, /활용신청/);
  } finally {
    await app.close();
  }
});
