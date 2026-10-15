'use strict';

// 전통시장 하루 평균 매출액 CSV: 읽기(세로·가로 표), 기본 자료, 올리기·되돌리기 API를 검사한다.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSalesTable, splitUnit, BUILTIN_CSV } = require('../sales.js');
const { parseCsv } = require('../onnuri.js');
const { createServer } = require('../server.js');

const read = (text) => readSalesTable(parseCsv(text));

test('받은 파일 모양(순번, 구분별, 전체 (만원), 데이터 기준일자)을 읽는다', () => {
  const t = read(BUILTIN_CSV);
  assert.equal(t.yearly, true);
  assert.equal(t.labelName, '구분별');
  assert.deepEqual(t.series, [{ name: '전체', unit: '만원' }]);
  assert.deepEqual(t.rows.map((r) => [r.label, r.values[0], r.date]), [
    ['2017', 5125, '2017-12-31'],
    ['2018', 5409.2, '2018-12-31'],
    ['2019', 5749.2, '2019-12-31'],
  ]);
});

test('열이 늘거나, 연도 순서가 섞이거나, 천 단위 쉼표가 있어도 읽는다', () => {
  const t = read('순번,구분별,전체 (만원),도시형 (만원),데이터 기준일자\n2,2020년,"5,100",-,2020-12-31\n1,2019,5749.2,6000,2019-12-31\n');
  assert.deepEqual(t.series.map((s) => s.name), ['전체', '도시형']);
  assert.deepEqual(t.rows.map((r) => r.label), ['2019', '2020'], '연도 순으로 놓고 "년"을 뗀다');
  assert.deepEqual(t.rows[1].values, [5100, null]);
});

test('연도가 가로로 놓인 표는 세로로 돌린다', () => {
  const t = read('구분 (만원),2017,2018,2019\n전체,5125,5409.2,5749.2\n도시형,6000,6100,6200\n');
  assert.equal(t.yearly, true);
  assert.deepEqual(t.series, [{ name: '전체', unit: '만원' }, { name: '도시형', unit: '만원' }]);
  assert.deepEqual(t.rows.map((r) => [r.label, ...r.values]), [['2017', 5125, 6000], ['2018', 5409.2, 6100], ['2019', 5749.2, 6200]]);
});

test('연도가 아닌 구분(지역 등)도 읽고, 숫자 열이 없으면 알려 준다', () => {
  const t = read('지역,일평균 매출액(만원)\n서울,7000\n경북,4000\n');
  assert.equal(t.yearly, false);
  assert.deepEqual(t.rows.map((r) => r.label), ['서울', '경북'], '연도가 아니면 파일 순서 그대로');
  assert.throws(() => read('이름,주소\n가,나\n'), /숫자 열/);
  assert.deepEqual(splitUnit('전체（만원）'), { name: '전체', unit: '만원' });
});

test('서버 API: 처음에는 기본 자료, 올리면 그 파일, 되돌리면 다시 기본 자료', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-'));
  const server = createServer({ serviceKey: 'k', maxPages: 1, sdscBaseUrl: 'http://127.0.0.1:9', nominatimUrl: 'http://127.0.0.1:9', dataDir: dir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body, type) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': type }, body });
  try {
    const first = await (await fetch(`${base}/api/sales`)).json();
    assert.equal(first.source, 'builtin');
    assert.equal(first.dataDate, '2019-12-31');
    assert.equal(first.rows.length, 3);

    const csv = Buffer.from('﻿순번,구분별,전체 (만원),데이터 기준일자\r\n1,2020,5000,2020-12-31\r\n', 'utf8');
    assert.equal((await post('/api/sales/upload?name=x.csv', csv, 'text/plain')).status, 415);
    assert.equal((await post('/api/sales/upload?name=x.csv', Buffer.from('a,b\n가,나\n'), 'application/octet-stream')).status, 400);
    const up = await (await post(`/api/sales/upload?name=${encodeURIComponent('매출_20201231.csv')}`, csv, 'application/octet-stream')).json();
    assert.equal(up.source, 'file');
    assert.deepEqual(up.rows[0].values, [5000]);
    assert.equal((await (await fetch(`${base}/api/sales`)).json()).fileName, '매출_20201231.csv', '다시 열어도 올린 파일');

    assert.equal((await post('/api/sales/reset', '{}', 'text/plain')).status, 415);
    const back = await (await post('/api/sales/reset', '{}', 'application/json')).json();
    assert.equal(back.source, 'builtin');
    assert.equal(fs.existsSync(path.join(dir, 'sales.json')), false);

    const page = await fetch(`${base}/sales.html`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /전통시장 하루 평균 매출액/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
