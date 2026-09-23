'use strict';

// SHP 저장·읽기, ZIP, 좌표계 짐작을 검사한다.
// fixtures/seoul_5186.* 은 다른 프로그램(pyshp)으로 만든 파일이다: EPSG:5186, CP949 한글, .cpg 없음,
// 구멍 뚫린 면 1개 + 빈 도형 1개.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Shapefile = require('../public/shapefile.js');
const Crs = require('../public/crs.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const fixtureFiles = () =>
  fs.readdirSync(FIXTURES).map((name) => ({ name, data: new Uint8Array(fs.readFileSync(path.join(FIXTURES, name))) }));

const FIELDS = [
  { name: 'NAME', type: 'C', length: 10 },
  { name: 'ADDR', type: 'C', length: 254 },
  { name: 'LON', type: 'N', length: 14, decimals: 8 },
  { name: 'LAT', type: 'N', length: 13, decimals: 8 },
];

test('점 SHP를 만들고 ZIP으로 묶었다가 다시 읽으면 그대로 나온다', async () => {
  const features = [
    { x: 128.1136, y: 36.1198, attributes: { NAME: '김천떡볶이집입니다', ADDR: '경상북도 김천시 자산로 123', LON: 128.1136, LAT: 36.1198 } },
    { x: 128.11425, y: 36.12011, attributes: { NAME: 'A&B', ADDR: '', LON: 128.11425, LAT: 36.12011 } },
  ];
  const set = Shapefile.writePointShapefile(features, FIELDS);
  assert.equal(set.shp.length, 100 + 28 * 2);
  assert.equal(set.shx.length, 100 + 8 * 2);

  const text = new TextEncoder();
  const zipped = await Shapefile.zip([
    { name: 'stores.shp', data: set.shp },
    { name: 'stores.shx', data: set.shx },
    { name: 'stores.dbf', data: set.dbf },
    { name: 'stores.prj', data: text.encode(Shapefile.WGS84_PRJ) },
    { name: 'stores.cpg', data: text.encode('UTF-8') },
  ]);
  const files = await Shapefile.unzip(zipped);
  assert.deepEqual(files.map((f) => f.name), ['stores.shp', 'stores.shx', 'stores.dbf', 'stores.prj', 'stores.cpg']);

  const [group] = Shapefile.groupShapefiles(files);
  const result = Shapefile.readShapefile(group);
  assert.equal(result.encoding, 'utf-8');
  assert.equal(Crs.detectCrs(result.prj).code, 'EPSG:4326');
  assert.deepEqual(result.features.map((f) => f.geometry), [
    { type: 'Point', coordinates: [128.1136, 36.1198] },
    { type: 'Point', coordinates: [128.11425, 36.12011] },
  ]);
  // 10바이트 칸에 한글(3바이트)이 들어가면 글자 중간이 아니라 글자 단위로 잘린다.
  assert.deepEqual(result.features[0].properties, { NAME: '김천떡', ADDR: '경상북도 김천시 자산로 123', LON: 128.1136, LAT: 36.1198 });
  assert.deepEqual(result.features[1].properties, { NAME: 'A&B', ADDR: '', LON: 128.11425, LAT: 36.12011 });
});

test('가게가 0개여도 올바른 빈 SHP를 만든다', () => {
  const set = Shapefile.writePointShapefile([], FIELDS);
  assert.equal(set.shp.length, 100);
  assert.deepEqual(Shapefile.readShapefile({ name: 'empty', ...set }).features, []);
});

test('다른 프로그램이 만든 CP949 면 SHP를 읽는다 (.cpg 없음)', () => {
  const [group] = Shapefile.groupShapefiles(fixtureFiles());
  const result = Shapefile.readShapefile(group);
  assert.equal(result.name, 'seoul_5186');
  assert.equal(result.encoding, 'euc-kr');
  assert.deepEqual(result.fields, ['ADM_NM', '코드', 'AREA']);
  assert.equal(result.features.length, 1, '빈 도형은 건너뛴다');

  const [feature] = result.features;
  assert.deepEqual(feature.properties, { ADM_NM: '서울특별시 중구 태평로1가', 코드: '1114055000', AREA: 150000 });
  assert.equal(feature.geometry.type, 'Polygon');
  assert.equal(feature.geometry.coordinates.length, 2, '바깥 고리 + 구멍');
  assert.deepEqual(feature.geometry.coordinates[0][0], [198048 - 200, 551863 - 200]);

  const crs = Crs.detectCrs(result.prj);
  assert.equal(crs.code, 'EPSG:5186');
  assert.equal(crs.source, 'prj');
});

test('ZIP 안의 폴더·맥 찌꺼기 파일·다른 파일을 가려서 SHP 세트로 묶는다', () => {
  const bytes = new Uint8Array([0]);
  const sets = Shapefile.groupShapefiles([
    { name: 'data/동경계.SHP', data: bytes },
    { name: 'data/동경계.dbf', data: bytes },
    { name: 'data/동경계.prj', data: bytes },
    { name: '__MACOSX/data/._동경계.shp', data: bytes },
    { name: 'readme.txt', data: bytes },
    { name: 'only_dbf.dbf', data: bytes },
  ]);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].name, '동경계');
  assert.deepEqual(Object.keys(sets[0]).sort(), ['dbf', 'name', 'prj', 'shp']);
});

test('.cpg 내용으로 인코딩을 고르고, 없으면 내용을 보고 정한다', () => {
  const ascii = new TextEncoder().encode('abc');
  assert.equal(Shapefile.detectEncoding('UTF-8', ascii), 'utf-8');
  assert.equal(Shapefile.detectEncoding('949', ascii), 'euc-kr');
  assert.equal(Shapefile.detectEncoding('CP949', ascii), 'euc-kr');
  assert.equal(Shapefile.detectEncoding('1252', ascii), 'windows-1252');
  assert.equal(Shapefile.detectEncoding('', new TextEncoder().encode('한글')), 'utf-8');
  assert.equal(Shapefile.detectEncoding('', new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb])), 'euc-kr'); // "한글" in CP949
});

test('.prj가 없으면 좌표 범위로 좌표계를 짐작한다', () => {
  assert.equal(Crs.detectCrs('', [126.9, 37.5, 127.0, 37.6]).code, 'EPSG:4326');
  assert.equal(Crs.detectCrs('', [950000, 1950000, 960000, 1960000]).code, 'EPSG:5179');
  assert.equal(Crs.detectCrs('', [14100000, 4500000, 14200000, 4600000]).code, 'EPSG:3857');
  const tm = Crs.detectCrs('', [197000, 551000, 199000, 553000]);
  assert.equal(tm.code, 'EPSG:5186');
  assert.equal(tm.source, 'guess');
});

test('Bessel 기반 옛 좌표계(.prj에 변환값 없음)에도 한국 측지계 변환값을 붙인다', () => {
  const esri5174 =
    'PROJCS["Korean_1985_Modified_Korea_Central_Belt",GEOGCS["GCS_Korean_Datum_1985",DATUM["D_Korean_Datum_1985",' +
    'SPHEROID["Bessel_1841",6377397.155,299.1528128]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],' +
    'PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000.0],PARAMETER["False_Northing",500000.0],' +
    'PARAMETER["Central_Meridian",127.0028902777778],PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",38.0],' +
    'UNIT["Meter",1.0]]';
  const crs = Crs.detectCrs(esri5174);
  assert.equal(crs.code, 'EPSG:5174');
  assert.match(crs.def, /\+ellps=bessel \+towgs84=-115\.8,474\.99,674\.11/);

  const custom = Crs.detectCrs(esri5174.replace('127.0028902777778', '125.0028902777778'));
  assert.equal(custom.code, 'custom');
  assert.match(custom.def, /\+lon_0=125\.0028902777778 .*\+ellps=bessel \+towgs84=/);
});

test('엑셀 파일: 시트 이름을 정리하고, 글자를 XML에 맞게 바꾸고, 첫 행을 고정한다', async () => {
  const Xlsx = require('../public/xlsx.js');
  const bytes = await Xlsx.build([
    { name: '요약', rows: [['항목', '내용'], ['가게 수', 3], ['비율', { value: 0.5, style: 'percent' }]], header: true },
    { name: '수리/개인', rows: [['상호명'], ['A&B <카페> "1호"\u0001']], header: true, autoFilter: true },
    { name: '수리/개인', rows: [['상호명']] },
  ]);
  const files = Object.fromEntries((await Shapefile.unzip(bytes)).map((f) => [f.name, new TextDecoder().decode(f.data)]));
  assert.ok(files['[Content_Types].xml'] && files['xl/styles.xml'] && files['_rels/.rels']);
  assert.match(files['xl/workbook.xml'], /<sheet name="요약" sheetId="1"/);
  assert.match(files['xl/workbook.xml'], /<sheet name="수리·개인" sheetId="2"/);
  assert.match(files['xl/workbook.xml'], /<sheet name="수리·개인_2" sheetId="3"/);
  assert.match(files['xl/workbook.xml'], /'수리·개인'!\$A\$1:\$A\$2/);
  assert.match(files['xl/worksheets/sheet1.xml'], /<c r="B2"><v>3<\/v><\/c>/);
  assert.match(files['xl/worksheets/sheet1.xml'], /<c r="B3" s="2"><v>0.5<\/v><\/c>/);
  assert.match(files['xl/worksheets/sheet1.xml'], /state="frozen"/);
  assert.match(files['xl/worksheets/sheet2.xml'], /A&amp;B &lt;카페&gt; &quot;1호&quot;<\/t>/);
  assert.match(files['xl/worksheets/sheet2.xml'], /<autoFilter ref="A1:A2"\/>/);
});
