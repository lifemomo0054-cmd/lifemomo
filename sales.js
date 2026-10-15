'use strict';

// 전통시장 일(당일) 평균 매출액 (소상공인시장진흥공단 전통시장 실태조사, 공공데이터포털 CSV)
//
// 받은 파일은 "순번, 구분별(연도), 전체 (만원), 데이터 기준일자" 모양의 작은 표다.
// 열 이름을 미리 정해 두지 않고, 숫자 열은 모두 값으로 본다. 그래서 다음 해 파일에
// 연도가 늘거나 "도시형·중형" 같은 열이 붙어도 그대로 읽힌다.
// 연도가 열 이름으로 가로로 놓인 표(구분 | 2017 | 2018 …)는 세로로 돌려 같은 모양으로 맞춘다.
// 파일을 올리기 전에는 처음 받은 2017~2019년 자료를 기본으로 보여 준다.

const fs = require('node:fs/promises');
const path = require('node:path');
const { parseCsv, decodeCsv } = require('./onnuri.js');

const SAVED_FILE = 'sales.json';

// 공공데이터포털 "소상공인시장진흥공단_전통시장 일평균 매출액" (2019-12-31 기준) 원본 그대로
const BUILTIN_CSV =
  '순번,구분별,전체 (만원),데이터 기준일자\n' +
  '1,2017,5125,2017-12-31\n' +
  '2,2018,5409.2,2018-12-31\n' +
  '3,2019,5749.2,2019-12-31\n';
const BUILTIN_NAME = '소상공인시장진흥공단_전통시장 일평균 매출액_20191231.csv';

const SKIP_COLUMN = /^(순번|번호|연번|no\.?)$/i;
const DATE_COLUMN = /기준\s*일|일자|날짜/;
const LABEL_COLUMN = /^(구분|구분별|연도|년도|기간|조사\s*연도|항목|지역|시도)$/;
const YEAR = /^(19|20)\d{2}(\s*년)?$/;

// "5,749.2" → 5749.2, 빈칸·글자는 null
function toNumber(text) {
  const s = String(text ?? '').replace(/,/g, '').trim();
  if (!s || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// "전체 (만원)" → { name: '전체', unit: '만원' }
function splitUnit(header) {
  const m = String(header).match(/^(.*?)\s*[(（\[]\s*([^)）\]]+?)\s*[)）\]]\s*$/);
  return m && m[1] ? { name: m[1].trim(), unit: m[2] } : { name: String(header).trim(), unit: '' };
}

const isYear = (s) => YEAR.test(String(s).trim());

// 파싱한 CSV(첫 줄 머리글) → { labelName, series: [{name, unit}], rows: [{label, date, values}] }
function readSalesTable(table) {
  const [rawHeader, ...rawBody] = table;
  if (!rawHeader || rawHeader.length < 2) throw new Error('표 모양의 CSV 파일이 아닙니다(머리글과 내용이 있어야 합니다).');
  const header = rawHeader.map((h, i) => String(h).trim() || `열${i + 1}`);
  const body = rawBody.filter((r) => r.some((c) => String(c).trim()));
  if (!body.length) throw new Error('CSV 파일에 내용이 없습니다.');

  const cols = header.map((h, i) => ({ h, i }));
  const skip = new Set(cols.filter(({ h }) => SKIP_COLUMN.test(h)).map(({ i }) => i));
  const dateCol = cols.find(({ h, i }) => !skip.has(i) && DATE_COLUMN.test(h));
  if (dateCol) skip.add(dateCol.i);

  // 값 열: 비어 있지 않은 칸이 모두 숫자인 열
  const numeric = (i) => {
    const cells = body.map((r) => String(r[i] ?? '').trim()).filter((c) => c && c !== '-');
    return cells.length > 0 && cells.every((c) => toNumber(c) !== null);
  };
  let labelCol = cols.find(({ h, i }) => !skip.has(i) && LABEL_COLUMN.test(h));
  if (!labelCol) labelCol = cols.find(({ i }) => !skip.has(i) && !numeric(i)) || cols.find(({ i }) => !skip.has(i));
  const valueCols = cols.filter(({ i }) => !skip.has(i) && i !== labelCol.i && numeric(i));
  if (!valueCols.length) throw new Error('매출액 같은 숫자 열을 찾지 못했습니다. 공공데이터포털에서 받은 원본 CSV인지 확인해 주세요.');

  let labelName = labelCol.h;
  let series = valueCols.map(({ h }) => splitUnit(h));
  let rows = body.map((r) => ({
    label: String(r[labelCol.i] ?? '').trim(),
    date: dateCol ? String(r[dateCol.i] ?? '').trim() : '',
    values: valueCols.map(({ i }) => toNumber(r[i])),
  }));

  // 가로로 놓인 연도(구분 | 2017 | 2018 …) → 세로로 돌린다
  if (valueCols.length >= 2 && series.every((s) => isYear(s.name)) && !rows.every((r) => isYear(r.label))) {
    const unit = splitUnit(labelCol.h).unit || series[0].unit;
    const turned = valueCols.map((c, k) => ({ label: series[k].name.replace(/\s*년$/, ''), date: '', values: rows.map((r) => r.values[k]) }));
    series = rows.map((r) => ({ ...splitUnit(r.label), unit: splitUnit(r.label).unit || unit }));
    rows = turned;
    labelName = '연도';
  }

  rows = rows.filter((r) => r.label && r.values.some((v) => v !== null));
  if (!rows.length) throw new Error('읽을 수 있는 줄이 없습니다.');
  const yearly = rows.every((r) => isYear(r.label));
  if (yearly) {
    for (const r of rows) r.label = r.label.replace(/\s*년$/, '');
    rows.sort((a, b) => Number(a.label) - Number(b.label));
  }
  return { labelName, series, rows, yearly };
}

// 파일 이름 끝의 _20191231 → '2019-12-31'
function dateFromName(fileName) {
  const m = String(fileName || '').match(/(20\d{2})(\d{2})(\d{2})(?!\d)/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function buildValue(buffer, fileName) {
  const table = readSalesTable(parseCsv(decodeCsv(buffer)));
  const dates = table.rows.map((r) => r.date).filter(Boolean).sort();
  return { fileName, dataDate: dates[dates.length - 1] || dateFromName(fileName), ...table };
}

function createSales({ dataDir }) {
  const savedPath = () => path.join(dataDir, SAVED_FILE);
  const builtin = () => ({ ...buildValue(Buffer.from(BUILTIN_CSV, 'utf8'), BUILTIN_NAME), source: 'builtin' });

  async function get() {
    try {
      return { ...JSON.parse(await fs.readFile(savedPath(), 'utf8')), source: 'file' };
    } catch {
      return builtin();
    }
  }

  async function saveUpload(buffer, fileName) {
    const value = { ...buildValue(buffer, fileName), savedAt: new Date().toISOString() };
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(savedPath(), JSON.stringify(value));
    return { ...value, source: 'file' };
  }

  async function reset() {
    await fs.rm(savedPath(), { force: true });
    return builtin();
  }

  return { get, saveUpload, reset };
}

module.exports = { createSales, readSalesTable, splitUnit, toNumber, dateFromName, BUILTIN_CSV };
