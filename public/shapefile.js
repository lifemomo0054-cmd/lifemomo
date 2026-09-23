'use strict';

// SHP(ESRI Shapefile)·DBF·ZIP 파일을 읽고 쓰는 작은 모듈.
// 브라우저에서는 window.Shapefile 로, Node(테스트)에서는 require 로 쓴다.
// 참고한 형식: ESRI Shapefile Technical Description(1998), dBASE III 파일 구조, ZIP APPNOTE.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Shapefile = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const utf8 = new TextEncoder();

  // QGIS가 EPSG:4326(WGS84 경위도)으로 알아보는 좌표계 정의
  const WGS84_PRJ =
    'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
    'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

  // ── 쓰기 ───────────────────────────────────────────────────────────────

  // 점(Point) 도형 SHP 세트를 만든다.
  // fields:   [{ name: 'NAME', type: 'C', length: 100 }, { name: 'LON', type: 'N', length: 12, decimals: 7 }]
  // features: [{ x, y, attributes: { NAME: '...', LON: 127.1 } }]
  function writePointShapefile(features, fields) {
    const n = features.length;
    const shp = new DataView(new ArrayBuffer(100 + 28 * n));
    const shx = new DataView(new ArrayBuffer(100 + 8 * n));
    const bbox = boundsOf(features);
    writeMainHeader(shp, 100 + 28 * n, bbox);
    writeMainHeader(shx, 100 + 8 * n, bbox);
    features.forEach((f, i) => {
      const at = 100 + 28 * i;
      shp.setInt32(at, i + 1); // 레코드 번호 (big-endian)
      shp.setInt32(at + 4, 10); // 내용 길이, 16비트 단위 (big-endian)
      shp.setInt32(at + 8, 1, true); // 도형 종류: Point
      shp.setFloat64(at + 12, f.x, true);
      shp.setFloat64(at + 20, f.y, true);
      shx.setInt32(100 + 8 * i, at / 2);
      shx.setInt32(100 + 8 * i + 4, 10);
    });
    return {
      shp: new Uint8Array(shp.buffer),
      shx: new Uint8Array(shx.buffer),
      dbf: writeDbf(features.map((f) => f.attributes), fields),
    };
  }

  function boundsOf(features) {
    if (!features.length) return [0, 0, 0, 0];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { x, y } of features) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return [minX, minY, maxX, maxY];
  }

  function writeMainHeader(view, byteLength, [minX, minY, maxX, maxY]) {
    view.setInt32(0, 9994); // 파일 코드 (big-endian)
    view.setInt32(24, byteLength / 2); // 파일 길이, 16비트 단위 (big-endian)
    view.setInt32(28, 1000, true); // 버전
    view.setInt32(32, 1, true); // 도형 종류: Point
    view.setFloat64(36, minX, true);
    view.setFloat64(44, minY, true);
    view.setFloat64(52, maxX, true);
    view.setFloat64(60, maxY, true);
  }

  // dBASE III 속성 파일. 문자는 UTF-8로 넣고, 같은 이름의 .cpg 파일로 인코딩을 알린다.
  function writeDbf(records, fields) {
    const recordLength = 1 + fields.reduce((sum, f) => sum + f.length, 0);
    const headerLength = 32 + 32 * fields.length + 1;
    const bytes = new Uint8Array(headerLength + recordLength * records.length + 1);
    const view = new DataView(bytes.buffer);
    const today = new Date();
    bytes[0] = 0x03;
    bytes[1] = today.getFullYear() - 1900;
    bytes[2] = today.getMonth() + 1;
    bytes[3] = today.getDate();
    view.setUint32(4, records.length, true);
    view.setUint16(8, headerLength, true);
    view.setUint16(10, recordLength, true);
    fields.forEach((f, i) => {
      const at = 32 + 32 * i;
      bytes.set(utf8.encode(f.name).subarray(0, 10), at); // 필드 이름은 영문 10자까지
      bytes[at + 11] = f.type.charCodeAt(0);
      bytes[at + 16] = f.length;
      bytes[at + 17] = f.decimals || 0;
    });
    bytes[headerLength - 1] = 0x0d;

    let at = headerLength;
    for (const record of records) {
      bytes.fill(0x20, at, at + recordLength); // 삭제 표시(공백) + 빈칸 채움
      let pos = at + 1;
      for (const f of fields) {
        const value = encodeField(record[f.name], f);
        bytes.set(value, f.type === 'N' ? pos + f.length - value.length : pos); // 숫자는 오른쪽 정렬
        pos += f.length;
      }
      at += recordLength;
    }
    bytes[at] = 0x1a;
    return bytes;
  }

  function encodeField(value, field) {
    if (value == null || value === '') return new Uint8Array(0);
    if (field.type === 'N') {
      const n = Number(value);
      const text = Number.isFinite(n) ? n.toFixed(field.decimals || 0) : '';
      return text.length <= field.length ? utf8.encode(text) : new Uint8Array(0);
    }
    return truncateUtf8(utf8.encode(String(value)), field.length);
  }

  // 한글(UTF-8 3바이트)이 중간에서 잘리지 않게 maxBytes 안으로 자른다.
  function truncateUtf8(bytes, maxBytes) {
    if (bytes.length <= maxBytes) return bytes;
    let end = maxBytes;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
    return bytes.subarray(0, end);
  }

  // files: [{ name, data: Uint8Array }] → ZIP 파일 바이트.
  // 브라우저가 지원하면 압축(deflate)하고, 아니면 그대로 담는다.
  async function zip(files) {
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const file of files) {
      const name = utf8.encode(file.name);
      const crc = crc32(file.data);
      const deflated = await deflateRaw(file.data);
      const useDeflate = deflated && deflated.length < file.data.length;
      const body = useDeflate ? deflated : file.data;
      const method = useDeflate ? 8 : 0;

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // 파일 이름이 UTF-8
      local.setUint16(8, method, true);
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, body.length, true);
      local.setUint32(22, file.data.length, true);
      local.setUint16(26, name.length, true);
      locals.push(new Uint8Array(local.buffer), name, body);

      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true);
      central.setUint16(6, 20, true);
      central.setUint16(8, 0x0800, true);
      central.setUint16(10, method, true);
      central.setUint16(12, time, true);
      central.setUint16(14, date, true);
      central.setUint32(16, crc, true);
      central.setUint32(20, body.length, true);
      central.setUint32(24, file.data.length, true);
      central.setUint16(28, name.length, true);
      central.setUint32(42, offset, true);
      centrals.push(new Uint8Array(central.buffer), name);

      offset += 30 + name.length + body.length;
    }
    const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return concat([...locals, ...centrals, new Uint8Array(end.buffer)]);
  }

  // ── 읽기 ───────────────────────────────────────────────────────────────

  // ZIP 안의 파일 중 wanted(name)가 참인 것만 풀어서 [{ name, data }]로 준다.
  async function unzip(buffer, wanted = () => true) {
    const bytes = toBytes(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('ZIP 파일이 아니거나 손상된 파일입니다.');

    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const entries = [];
    for (let i = 0; i < count; i++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP 파일 목록을 읽지 못했습니다.');
      const flags = view.getUint16(p + 8, true);
      const method = view.getUint16(p + 10, true);
      const compressedSize = view.getUint32(p + 20, true);
      const nameLength = view.getUint16(p + 28, true);
      const extraLength = view.getUint16(p + 30, true);
      const commentLength = view.getUint16(p + 32, true);
      const localOffset = view.getUint32(p + 42, true);
      const name = decodeFileName(bytes.subarray(p + 46, p + 46 + nameLength), flags);
      p += 46 + nameLength + extraLength + commentLength;
      if (name.endsWith('/') || !wanted(name)) continue;
      if (flags & 1) throw new Error('암호가 걸린 ZIP 파일은 열 수 없습니다.');
      if (method !== 0 && method !== 8) throw new Error(`지원하지 않는 압축 방식입니다: ${name}`);
      const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
      entries.push({ name, method, raw: bytes.subarray(start, start + compressedSize) });
    }
    return Promise.all(
      entries.map(async (e) => ({ name: e.name, data: e.method === 8 ? await inflateRaw(e.raw) : e.raw })),
    );
  }

  function decodeFileName(bytes, flags) {
    if (flags & 0x0800) return new TextDecoder('utf-8').decode(bytes);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return decodeWith('euc-kr', bytes); // 한글 Windows에서 만든 ZIP
    }
  }

  // 여러 파일 중 같은 이름끼리 묶어 SHP 세트를 만든다. .shp가 없는 세트는 버린다.
  function groupShapefiles(files) {
    const sets = new Map();
    for (const file of files) {
      const path = file.name.replace(/\\/g, '/');
      const base = path.split('/').pop();
      const m = base.match(/^(.*)\.(shp|shx|dbf|prj|cpg)$/i);
      if (!m || base.startsWith('._') || path.startsWith('__MACOSX/')) continue;
      const key = path.slice(0, -m[2].length - 1).toLowerCase();
      if (!sets.has(key)) sets.set(key, { name: m[1] });
      sets.get(key)[m[2].toLowerCase()] = toBytes(file.data);
    }
    return [...sets.values()].filter((set) => set.shp);
  }

  // SHP 세트 { name, shp, dbf?, prj?, cpg? } → { name, features: [{ geometry, properties }], fields, encoding, prj }
  // geometry는 GeoJSON과 비슷하지만, Polygon은 바깥 고리와 구멍을 구분하지 않고 모든 고리를 담는다.
  // (지도는 짝홀 규칙으로 채우므로 구멍과 여러 조각이 그대로 맞게 그려진다.)
  function readShapefile(set) {
    const shapes = readShp(set.shp);
    const table = set.dbf ? readDbf(set.dbf, set.cpg ? decodeWith('utf-8', set.cpg) : '') : null;
    const features = [];
    shapes.forEach((geometry, i) => {
      if (geometry) features.push({ geometry, properties: (table && table.records[i]) || {} });
    });
    return {
      name: set.name,
      features,
      fields: table ? table.fields : [],
      encoding: table ? table.encoding : '',
      prj: set.prj ? decodeWith('utf-8', set.prj).trim() : '',
    };
  }

  function readShp(buffer) {
    const bytes = toBytes(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.byteLength < 100 || view.getInt32(0) !== 9994) throw new Error('.shp 파일 형식이 아닙니다.');
    const shapes = [];
    let p = 100;
    while (p + 8 <= view.byteLength) {
      const contentBytes = view.getInt32(p + 4) * 2;
      const start = p + 8;
      if (contentBytes < 4 || start + contentBytes > view.byteLength) break;
      let shape = null;
      try {
        shape = readShape(view, start);
      } catch {
        // 망가진 레코드 하나 때문에 전체를 버리지 않는다.
      }
      shapes.push(shape);
      p = start + contentBytes;
    }
    return shapes;
  }

  function readShape(view, at) {
    const type = view.getInt32(at, true);
    switch (type) {
      case 1: case 11: case 21: // Point, PointZ, PointM
        return { type: 'Point', coordinates: [view.getFloat64(at + 4, true), view.getFloat64(at + 12, true)] };
      case 8: case 18: case 28: // MultiPoint
        return { type: 'MultiPoint', coordinates: readPoints(view, at + 40, view.getInt32(at + 36, true)) };
      case 3: case 13: case 23: // PolyLine
      case 5: case 15: case 25: { // Polygon
        const numParts = view.getInt32(at + 36, true);
        const numPoints = view.getInt32(at + 40, true);
        const partsAt = at + 44;
        const pointsAt = partsAt + 4 * numParts;
        const parts = [];
        for (let i = 0; i < numParts; i++) {
          const from = view.getInt32(partsAt + 4 * i, true);
          const to = i + 1 < numParts ? view.getInt32(partsAt + 4 * (i + 1), true) : numPoints;
          parts.push(readPoints(view, pointsAt + 16 * from, to - from));
        }
        if (type % 10 === 5) return { type: 'Polygon', coordinates: parts };
        return parts.length === 1
          ? { type: 'LineString', coordinates: parts[0] }
          : { type: 'MultiLineString', coordinates: parts };
      }
      default: // Null(0), MultiPatch(31) 등
        return null;
    }
  }

  function readPoints(view, at, count) {
    const points = new Array(count);
    for (let i = 0; i < count; i++) {
      points[i] = [view.getFloat64(at + 16 * i, true), view.getFloat64(at + 16 * i + 8, true)];
    }
    return points;
  }

  function readDbf(buffer, cpgText) {
    const bytes = toBytes(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(4, true);
    const headerLength = view.getUint16(8, true);
    const recordLength = view.getUint16(10, true);
    const rawFields = [];
    for (let at = 32; at + 32 <= headerLength && bytes[at] !== 0x0d; at += 32) {
      rawFields.push({
        nameBytes: stripNull(bytes.subarray(at, at + 11)),
        type: String.fromCharCode(bytes[at + 11]),
        length: bytes[at + 16],
      });
    }
    const encoding = detectEncoding(cpgText, bytes.subarray(32, bytes.length));
    const fields = rawFields.map((f) => ({ ...f, name: decodeWith(encoding, f.nameBytes).trim() }));

    const records = [];
    for (let i = 0; i < count; i++) {
      const at = headerLength + i * recordLength;
      if (at + recordLength > bytes.length) break;
      const row = {};
      let pos = at + 1;
      for (const f of fields) {
        row[f.name] = parseDbfValue(decodeWith(encoding, bytes.subarray(pos, pos + f.length)), f.type);
        pos += f.length;
      }
      records.push(row);
    }
    return { fields: fields.map((f) => f.name), records, encoding };
  }

  function parseDbfValue(text, type) {
    const t = text.replace(/\0/g, '').trim();
    if (type === 'N' || type === 'F') return t === '' || Number.isNaN(Number(t)) ? null : Number(t);
    if (type === 'L') return /^[TtYy]$/.test(t) ? true : /^[FfNn]$/.test(t) ? false : null;
    if (type === 'D' && /^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6)}`;
    return t;
  }

  // .cpg 파일이 알려 주는 인코딩을 쓰고, 없으면 UTF-8인지 보고 아니면 한글 Windows 기본(CP949)으로 본다.
  function detectEncoding(cpgText, sample) {
    const cpg = String(cpgText || '').trim();
    const key = cpg.toUpperCase().replace(/[\s_-]/g, '');
    if (/^(UTF8|65001)$/.test(key)) return 'utf-8';
    if (/^(949|CP949|MS949|ANSI949|WINDOWS949|EUCKR|KSC56011987|UHC|KOREAN)$/.test(key)) return 'euc-kr';
    if (cpg) {
      const label = /^\d+$/.test(cpg) ? `windows-${cpg}` : cpg;
      try {
        return new TextDecoder(label).encoding;
      } catch {
        // 모르는 이름이면 아래에서 내용을 보고 정한다.
      }
    }
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(sample);
      return 'utf-8';
    } catch {
      return 'euc-kr';
    }
  }

  // ── 공통 도우미 ────────────────────────────────────────────────────────

  function decodeWith(encoding, bytes) {
    try {
      return new TextDecoder(encoding).decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }

  function stripNull(bytes) {
    const end = bytes.indexOf(0);
    return end < 0 ? bytes : bytes.subarray(0, end);
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new Uint8Array(data);
  }

  function concat(parts) {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  async function deflateRaw(data) {
    if (typeof CompressionStream !== 'function') return null;
    try {
      const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      return null;
    }
  }

  async function inflateRaw(data) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('이 브라우저는 압축된 ZIP을 풀 수 없습니다. 최신 Chrome이나 Edge에서 열어 주세요.');
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  return {
    WGS84_PRJ,
    writePointShapefile,
    zip,
    unzip,
    groupShapefiles,
    readShapefile,
    readShp,
    readDbf,
    detectEncoding,
  };
});
