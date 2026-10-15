'use strict';

// 축제 정보 CSV: 읽기, 주소 다듬기, 주소로 위치 찾기(못 찾으면 시군 중심), 직접 찍기, 서버 API를 검사한다.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFestivals, readFestivals, addressQueries, cityQuery } = require('../festival.js');
const { parseCsv, decodeCsv } = require('../onnuri.js');
const { createServer } = require('../server.js');

// 실제 파일(경상북도 축제 정보)의 머리글과 몇 줄
const CSV = Buffer.from(
  '﻿지역명,축제명,도로명주소,전화번호,축제시작일,축제종료일,데이터작성일,데이터수정일,상세정보링크,홈페이지링크,주최기관명\r\n' +
    '영주,영주 소백산 철쭉제,경상북도 영주시 풍기읍 삼가로 509 영주시 소백산 일원 및 풍기인삼문화팝업공원,054-630-8703,2026-05-23,2026-05-24,2026-05-06,2026-05-15,https://tour.gb.go.kr/travel/festivalView.do?idx=21220,yctf.or.kr/azalea/,"영주시, 영주문화관광재단"\r\n' +
    '문경,문경 찻사발축제,경상북도 문경시 새재로 932,054-571-7677,2026-05-01,2026-05-10,2026-04-24,2026-04-24,https://tour.gb.go.kr/travel/festivalView.do?idx=21211,sabal21.com/,문경찻사발축제추진위원회\r\n' +
    '문경,문경약돌한우축제,경상북도 문경시 새재로 932,정보없음,2025-10-01,2025-10-05,2025-09-17,,https://tour.gb.go.kr/travel/festivalView.do?idx=1,정보없음,정보없음\r\n' +
    '안동,안동 벚꽃축제,탈춤공원 벚꽃길 일원,054-000-0000,2024-04-01,2024-04-07,2024-03-01,,https://tour.gb.go.kr/travel/festivalView.do?idx=2,,안동시\r\n',
  'utf8',
);

test('축제 CSV를 읽고 "정보없음"은 빈칸으로 둔다', () => {
  const list = readFestivals(parseCsv(decodeCsv(CSV)));
  assert.equal(list.length, 4);
  assert.deepEqual(list[0], {
    id: '0', name: '영주 소백산 철쭉제', region: '영주', address: '경상북도 영주시 풍기읍 삼가로 509 영주시 소백산 일원 및 풍기인삼문화팝업공원',
    phone: '054-630-8703', start: '2026-05-23', end: '2026-05-24', detailUrl: 'https://tour.gb.go.kr/travel/festivalView.do?idx=21220',
    homepage: 'yctf.or.kr/azalea/', host: '영주시, 영주문화관광재단',
  });
  assert.equal(list[2].phone, '');
  assert.equal(list[2].host, '');
});

test('주소 다듬기: 뒤의 설명을 떼고, 줄임말을 풀고, 장소 이름만 있으면 지역명을 붙인다', () => {
  assert.deepEqual(addressQueries('경상북도 영주시 풍기읍 삼가로 509 영주시 소백산 일원'), ['경상북도 영주시 풍기읍 삼가로 509', '경상북도 영주시 풍기읍 삼가로']);
  assert.deepEqual(addressQueries('경북 예천군 용궁면 대은리 347 회룡포'), ['경상북도 예천군 용궁면 대은리 347']);
  assert.deepEqual(addressQueries('경상북도 안동시 축제장길 200 (운흥동) 탈춤공원'), ['경상북도 안동시 축제장길 200', '경상북도 안동시 축제장길']);
  assert.deepEqual(addressQueries('탈춤공원 벚꽃길 일원', '안동'), ['안동 탈춤공원 벚꽃길']);
  assert.deepEqual(addressQueries('대가야역사테마관광지 및 대가야박물관 일원', '고령'), ['고령 대가야역사테마관광지']);
  assert.equal(cityQuery('경북 문경시 새재로 932'), '경상북도 문경시');
  assert.equal(cityQuery('탈춤공원 벚꽃길 일원', '안동', '경상북도'), '경상북도 안동');
});

async function loaded(searchPlace) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'festival-'));
  const festivals = createFestivals({ dataDir: dir, searchPlace, log: { error() {} } });
  await festivals.ready();
  await festivals.saveUpload(CSV, '경상북도 축제 정보_20260515.csv');
  return { festivals, dir };
}

const wait = async (f) => {
  while (f.status().search.running) await new Promise((r) => setTimeout(r, 10));
};

test('주소로 위치를 찾고, 못 찾으면 시군 중심에 대략 놓고, 직접 찍은 위치는 다시 켜도 남는다', async () => {
  const calls = [];
  const searchPlace = async (q, bbox) => {
    calls.push({ q, bbox });
    if (q === '경상북도 문경시 새재로 932') return { lat: 36.76, lng: 128.07, label: '문경새재' };
    if (q === '경상북도 영주시') return { lat: 36.8, lng: 128.62, label: '영주시' };
    if (q === '경상북도 안동') return { lat: 36.57, lng: 128.73, label: '안동시' };
    return null;
  };
  const { festivals, dir } = await loaded(searchPlace);
  assert.equal(festivals.status().addresses, 3, '같은 주소는 한 번만 찾는다');
  festivals.startSearch();
  await wait(festivals);

  const st = festivals.status();
  assert.deepEqual(st.bySource, { manual: 0, search: 1, approx: 2 });
  assert.match(st.search.message, /주소로 1곳, 시군 중심\(대략\)으로 2곳/);
  assert.deepEqual(calls[0].bbox, [127.8, 35.57, 131.88, 37.55], '경북 범위 안에서만 찾는다');
  assert.ok(calls.some((c) => c.q === '안동 탈춤공원 벚꽃길'), '장소 이름은 지역명을 붙여 찾는다');

  const list = festivals.list();
  assert.equal(list[1].locSource, 'search');
  assert.equal(list[2].lat, 36.76, '같은 주소의 다른 축제도 같은 위치');
  assert.equal(list[0].locSource, 'approx');
  assert.match(list[0].locLabel, /영주시 중심\(대략\)/);

  assert.ok(festivals.setLocation(list[3].address, 36.565, 128.725));
  assert.equal(festivals.setLocation('없는 주소', 36, 128), false);
  await festivals.flush();
  const again = createFestivals({ dataDir: dir, searchPlace: async () => null });
  await again.ready();
  assert.deepEqual(again.status().bySource, { manual: 1, search: 1, approx: 1 });
  assert.equal(again.status().dataDate, '20260515');
});

test('서버 API: 올리면 위치 찾기가 바로 시작되고, 축제 목록과 위치를 준다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'festival-api-'));
  const server = createServer({ serviceKey: 'k', maxPages: 1, sdscBaseUrl: 'http://127.0.0.1:9', nominatimUrl: 'http://127.0.0.1:9', dataDir: dir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body, type) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': type }, body });
  try {
    assert.equal((await (await fetch(`${base}/api/festivals`)).json()).status.loaded, false);
    const bad = await post('/api/festivals/upload?name=x.csv', Buffer.from('a,b\n1,2\n'), 'application/octet-stream');
    assert.equal(bad.status, 400);
    const up = await post(`/api/festivals/upload?name=${encodeURIComponent('축제_20260515.csv')}`, CSV, 'application/octet-stream');
    const st = await up.json();
    assert.equal(st.festivals, 4);
    assert.equal(st.search.running, true, '올리자마자 위치 찾기 시작');
    await post('/api/festivals/search', JSON.stringify({ action: 'stop' }), 'application/json');

    const { festivals } = await (await fetch(`${base}/api/festivals`)).json();
    assert.equal(festivals.length, 4);
    const pin = await post('/api/festivals/location', JSON.stringify({ address: festivals[1].address, lat: 36.76, lng: 128.07 }), 'application/json');
    assert.equal(pin.status, 200);
    const after = await (await fetch(`${base}/api/festivals`)).json();
    assert.equal(after.festivals[2].locSource, 'manual', '같은 주소 축제 모두에 적용');
    assert.equal((await post('/api/festivals/location', JSON.stringify({ address: festivals[1].address, lat: 40.7, lng: -74 }), 'application/json')).status, 400);
    assert.equal((await post('/api/festivals/location', JSON.stringify({ address: '없음', lat: 36, lng: 128 }), 'text/plain')).status, 415);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
