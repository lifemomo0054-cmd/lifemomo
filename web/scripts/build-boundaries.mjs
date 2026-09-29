// 시군구 경계 → web/public/data/boundaries.json (TopoJSON)
//
// 원자료: vuski/admdongkor 의 행정동 경계 ver20260401 (통계청 SGIS, 공공누리 제1유형 → CC BY 4.0)
//   데이터 기간(2026년 1~6월)과 코드 체계가 맞는 시점이다. 화성시 일반구(2026-02 신설)는 있고,
//   인천 제물포·영종·검단구(2026-07 신설)는 아직 없다.
// 행정동을 시군구 코드(sgg)로 합치고, 이웃 경계를 공유하는 방식으로 단순화한다(mapshaper).
//
//   npm run data:boundaries            (원자료를 받아 .cache/ 에 두고 변환)
//   npm run data:boundaries -- 파일.geojson   (이미 받은 원자료로 변환)

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';

const VERSION = 'ver20260401';
const SOURCE_URL = `https://raw.githubusercontent.com/vuski/admdongkor/master/${VERSION}/HangJeongDong_${VERSION}.geojson`;
const SOURCE_SHA256 = '90da81444f68b9a5b0bd5762f84bc6a8a9a702750c20223d52b1c5114cf7b0b1';
export const ATTRIBUTION =
  '행정구역 경계: 통계청 통계지리정보서비스(SGIS) 행정동 경계(공공누리 제1유형)를 vuski/admdongkor가 가공한 자료(CC BY 4.0)를 시군구로 합쳐 단순화';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cacheFile = resolve(web, '.cache', `HangJeongDong_${VERSION}.geojson`);
const outFile = resolve(web, 'public', 'data', 'boundaries.json');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function source() {
  const given = process.argv[2];
  if (given) return resolve(given);
  if (!existsSync(cacheFile)) {
    console.log(`원자료 받는 중: ${SOURCE_URL}`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`원자료를 받지 못했습니다 (${res.status}).`);
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, Buffer.from(await res.arrayBuffer()));
  }
  return cacheFile;
}

const input = await source();
const raw = readFileSync(input);
const digest = sha256(raw);
if (digest !== SOURCE_SHA256) {
  throw new Error(`원자료 SHA-256이 예상과 다릅니다: ${digest}\n예상: ${SOURCE_SHA256}`);
}

const result = await mapshaper.applyCommands(
  [
    '-i input.geojson',
    '-dissolve sgg copy-fields=sido,sidonm,sggnm',
    '-simplify 1.2% keep-shapes',
    '-rename-layers sgg',
    '-o format=topojson quantization=100000 id-field=sgg precision=0.00001 output.json',
  ].join(' '),
  { 'input.geojson': raw.toString('utf8') },
);
const topo = JSON.parse(result['output.json']);
topo.metadata = {
  source: SOURCE_URL,
  sourceSha256: SOURCE_SHA256,
  version: VERSION,
  attribution: ATTRIBUTION,
  license: 'CC BY 4.0 (원자료: 공공누리 제1유형)',
};
writeFileSync(outFile, JSON.stringify(topo));

const count = topo.objects.sgg.geometries.length;
console.log(`  → ${outFile.replace(`${web}/`, 'web/')} (시군구 ${count}개, ${statSync(outFile).size.toLocaleString('ko-KR')} bytes)`);
console.log(`※ ${ATTRIBUTION}`);
