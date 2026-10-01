'use strict';

// 소상공인시장진흥공단_전국 상권 현황 (공공데이터포털 15143727, odcloud 오픈API)
//
// 지역상권 실태조사를 바탕으로 한 시도별 표(17줄 안팎)다. 열 이름을 미리 정해 두지 않고
// 받은 그대로 화면에 넘겨서, 공단이 열을 바꿔도 그대로 보이게 한다.
// API가 아직 승인 전이거나 막혔을 때를 위해, 같은 데이터의 CSV 파일을 올려서 쓸 수도 있다.

const fs = require('node:fs/promises');
const path = require('node:path');
const { parseCsv, decodeCsv } = require('./onnuri.js');

const DEFAULT_URL = 'https://api.odcloud.kr/api/15143727/v1/uddi:ddbcfbd7-a6de-4f20-9a6e-b7d5d3493622';
const PER_PAGE = 1000;
const MAX_PAGES = 20;
const CACHE_MS = 60 * 60 * 1000;
const SAVED_FILE = 'sangkwon.json';

// odcloud가 주는 오류 → 화면에 보여줄 설명
function describeError(message, status) {
  if (status === 401 || status === 403 || /인증키|serviceKey|SERVICE_KEY/i.test(message)) {
    return (
      '이 인증키로 ‘전국 상권 현황’ API를 쓸 수 없습니다. 공공데이터포털에서 활용신청이 승인됐는지 확인하세요. ' +
      `승인 직후라면 1~2시간 걸릴 수 있습니다. (${message})`
    );
  }
  if (status === 429 || /LIMITED|초과/.test(message)) return '오늘 쓸 수 있는 API 호출 횟수를 모두 썼습니다. 내일 다시 시도하세요.';
  return `상권 현황 API 오류: ${message}`;
}

// 여러 줄의 열 이름을 처음 나온 순서대로 모은다.
function columnsOf(rows) {
  const seen = new Set();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
}

function createSangkwon({ serviceKey, url = DEFAULT_URL, dataDir, timeoutMs = 20_000 }) {
  let cache = null; // { at, value }
  let inflight = null;
  const savedPath = () => path.join(dataDir, SAVED_FILE);

  async function fetchPage(page) {
    const params = new URLSearchParams({ page: String(page), perPage: String(PER_PAGE), returnType: 'JSON', serviceKey });
    let res;
    let text;
    try {
      res = await fetch(`${url}?${params}`, { signal: AbortSignal.timeout(timeoutMs) });
      text = await res.text();
    } catch (err) {
      // 요청 주소에 인증키가 들어 있으므로 원인 메시지만 쓴다.
      throw new Error(`상권 현황 API에 연결하지 못했습니다 (${err.cause?.message || err.message}).`);
    }
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // 게이트웨이 오류는 XML이나 글자로 온다.
    }
    if (!res.ok || !json || !Array.isArray(json.data)) {
      const xml = text.match(/<returnAuthMsg>\s*([^<]*?)\s*<\/returnAuthMsg>/);
      throw new Error(describeError(json?.msg || json?.message || (xml && xml[1]) || `HTTP ${res.status}`, res.status));
    }
    return json;
  }

  async function fetchAll() {
    const rows = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const json = await fetchPage(page);
      rows.push(...json.data);
      const total = Number(json.matchCount ?? json.totalCount) || 0;
      if (!json.data.length || rows.length >= total) break;
    }
    return rows;
  }

  async function readSaved() {
    try {
      return JSON.parse(await fs.readFile(savedPath(), 'utf8'));
    } catch {
      return null;
    }
  }

  async function load() {
    let apiError = '서버에 인증키가 없습니다.';
    if (serviceKey) {
      try {
        const rows = await fetchAll();
        return { source: 'api', fetchedAt: new Date().toISOString(), columns: columnsOf(rows), rows };
      } catch (err) {
        apiError = err.message;
      }
    }
    const saved = await readSaved();
    if (saved) return { ...saved, source: 'file', warning: apiError };
    const error = new Error(`${apiError} 공공데이터포털에서 받은 ‘전국 상권 현황’ CSV 파일을 올려서 쓸 수도 있습니다.`);
    error.unavailable = true;
    throw error;
  }

  // 같은 내용을 한 시간 동안 기억한다(호출 한도 절약). refresh면 새로 받는다.
  function get({ refresh = false } = {}) {
    if (!refresh && cache && Date.now() - cache.at < CACHE_MS) return Promise.resolve(cache.value);
    if (inflight) return inflight;
    inflight = load()
      .then((value) => {
        if (value.source === 'api') cache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  async function saveUpload(buffer, fileName) {
    const [header, ...body] = parseCsv(decodeCsv(buffer));
    if (!header || header.length < 2 || !body.length) throw new Error('표 모양의 CSV 파일이 아닙니다(머리글과 내용이 있어야 합니다).');
    const names = header.map((h, i) => h.trim() || `열${i + 1}`);
    const rows = body.map((r) => Object.fromEntries(names.map((name, i) => [name, (r[i] ?? '').trim()])));
    const value = { fileName, savedAt: new Date().toISOString(), columns: names, rows };
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(savedPath(), JSON.stringify(value));
    cache = null; // 다음 요청 때 API를 먼저 다시 시도한다
    return { ...value, source: 'file' };
  }

  return { get, saveUpload };
}

module.exports = { createSangkwon, columnsOf, DEFAULT_URL };
