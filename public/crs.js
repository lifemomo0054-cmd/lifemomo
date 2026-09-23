'use strict';

// SHP 파일의 좌표계를 알아낸다. 한국에서 흔한 좌표계를 proj4 정의로 갖고 있다가,
// .prj 파일 내용과 맞춰 보고, .prj가 없으면 좌표 범위로 짐작한다.
// 실제 좌표 변환은 화면에서 proj4 라이브러리로 한다.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Crs = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Korean 1985(Bessel) → WGS84 변환값 (EPSG:5174 등에서 쓰는 값)
  const KOREA_1985_TOWGS84 = '-115.8,474.99,674.11,1.16,-2.31,-1.63,6.43';

  function tmDef({ lat0, lon0, k, x0, y0, ellps, toMeter }) {
    const datum = ellps === 'bessel' ? `+ellps=bessel +towgs84=${KOREA_1985_TOWGS84}` : '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0';
    const units = toMeter && toMeter !== 1 ? `+to_meter=${toMeter}` : '+units=m';
    return `+proj=tmerc +lat_0=${lat0} +lon_0=${lon0} +k=${k} +x_0=${x0} +y_0=${y0} ${datum} ${units} +no_defs`;
  }

  function tm(code, label, lat0, lon0, k, x0, y0, ellps) {
    const params = { lat0, lon0, k, x0, y0, ellps };
    return { code, label, params, def: tmDef(params) };
  }

  // 선택 목록에 보이는 순서이기도 하다.
  const KNOWN = [
    { code: 'EPSG:4326', label: 'WGS84 경위도 (EPSG:4326)', def: '+proj=longlat +datum=WGS84 +no_defs' },
    tm('EPSG:5186', '중부원점 GRS80 (EPSG:5186)', 38, 127, 1, 200000, 600000, 'GRS80'),
    tm('EPSG:5179', 'UTM-K GRS80 (EPSG:5179)', 38, 127.5, 0.9996, 1000000, 2000000, 'GRS80'),
    tm('EPSG:5181', '중부원점 GRS80, 가산 50만 (EPSG:5181)', 38, 127, 1, 200000, 500000, 'GRS80'),
    tm('EPSG:5174', '보정된 중부원점 Bessel (EPSG:5174)', 38, 127.0028902777778, 1, 200000, 500000, 'bessel'),
    tm('EPSG:5185', '서부원점 GRS80 (EPSG:5185)', 38, 125, 1, 200000, 600000, 'GRS80'),
    tm('EPSG:5187', '동부원점 GRS80 (EPSG:5187)', 38, 129, 1, 200000, 600000, 'GRS80'),
    tm('EPSG:5188', '동해원점 GRS80 (EPSG:5188)', 38, 131, 1, 200000, 600000, 'GRS80'),
    tm('EPSG:2097', '중부원점 Bessel (EPSG:2097)', 38, 127, 1, 200000, 500000, 'bessel'),
    tm('EPSG:5178', 'UTM-K Bessel (EPSG:5178)', 38, 127.5, 0.9996, 1000000, 2000000, 'bessel'),
    {
      code: 'EPSG:3857',
      label: '웹 메르카토르 (EPSG:3857)',
      def: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs',
    },
  ];

  const byCode = (code) => KNOWN.find((c) => c.code === code) || null;

  // prj: .prj 파일 내용, bbox: [minX, minY, maxX, maxY] (원래 좌표)
  // → { code, label, def, source: 'prj' | 'guess' }
  function detectCrs(prj, bbox) {
    const fromPrj = prj ? fromWkt(prj) : null;
    if (fromPrj) return { ...fromPrj, source: 'prj' };
    const guess = guessFromBounds(bbox);
    return { ...guess, label: `${guess.label} — 추정`, source: 'guess' };
  }

  function fromWkt(wkt) {
    const authority = [...wkt.matchAll(/AUTHORITY\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]/gi)].pop();
    if (authority && byCode(`EPSG:${authority[1]}`)) return byCode(`EPSG:${authority[1]}`);
    if (/Mercator_Auxiliary_Sphere|Pseudo[ _-]?Mercator|Web_Mercator/i.test(wkt)) return byCode('EPSG:3857');

    const spheroid = wkt.match(/SPHEROID\[\s*"[^"]*"\s*,\s*([\d.]+)/i);
    const ellps = spheroid && Math.abs(Number(spheroid[1]) - 6377397.155) < 1 ? 'bessel' : 'GRS80';

    if (/^\s*GEOGCS/i.test(wkt)) {
      if (ellps === 'GRS80') return byCode('EPSG:4326');
      return { code: 'custom', label: 'Bessel 경위도', def: `+proj=longlat +ellps=bessel +towgs84=${KOREA_1985_TOWGS84} +no_defs` };
    }
    if (!/^\s*PROJCS/i.test(wkt) || !/PROJECTION\[\s*"(Transverse_Mercator|Gauss_Kruger)"/i.test(wkt)) return null;

    const params = {
      lat0: param(wkt, 'latitude_of_origin'),
      lon0: param(wkt, 'central_meridian'),
      k: param(wkt, 'scale_factor') ?? 1,
      x0: param(wkt, 'false_easting') ?? 0,
      y0: param(wkt, 'false_northing') ?? 0,
      ellps,
      toMeter: linearUnit(wkt),
    };
    if (params.lat0 == null || params.lon0 == null) return null;
    const known = KNOWN.find((c) => c.params && sameTm(c.params, params));
    if (known) return known;
    return { code: 'custom', label: `.prj 파일의 TM 좌표계 (중앙 경도 ${params.lon0})`, def: tmDef(params) };
  }

  function param(wkt, name) {
    const m = wkt.match(new RegExp(`PARAMETER\\[\\s*"${name}"\\s*,\\s*([-\\d.eE+]+)`, 'i'));
    return m ? Number(m[1]) : null;
  }

  // 투영 좌표계의 길이 단위(미터 = 1). PARAMETER들 뒤에 오는 UNIT이 그것이다.
  function linearUnit(wkt) {
    const tail = wkt.slice(wkt.toUpperCase().lastIndexOf('PARAMETER'));
    const m = tail.match(/UNIT\[\s*"[^"]*"\s*,\s*([\d.eE+-]+)/i);
    return m ? Number(m[1]) : 1;
  }

  function sameTm(a, b) {
    const close = (x, y, tol) => Math.abs(x - y) <= tol;
    return (
      a.ellps === b.ellps &&
      (b.toMeter == null || b.toMeter === 1) &&
      close(a.lat0, b.lat0, 1e-6) &&
      close(a.lon0, b.lon0, 1e-6) &&
      close(a.k, b.k, 1e-9) &&
      close(a.x0, b.x0, 1e-3) &&
      close(a.y0, b.y0, 1e-3)
    );
  }

  // .prj가 없을 때 좌표 범위로 짐작한다. 중부원점 계열은 서로 범위가 겹쳐서 가장 흔한 5186으로 본다.
  function guessFromBounds(bbox) {
    const [minX, minY, maxX, maxY] = bbox || [0, 0, 0, 0];
    const within = (lo, hi, ...values) => values.every((v) => v >= lo && v <= hi);
    if (within(-180, 180, minX, maxX) && within(-90, 90, minY, maxY)) return byCode('EPSG:4326');
    if (within(600000, 1500000, minX, maxX) && within(1300000, 2300000, minY, maxY)) return byCode('EPSG:5179');
    if (within(13000000, 15500000, minX, maxX) && within(3500000, 5000000, minY, maxY)) return byCode('EPSG:3857');
    return byCode('EPSG:5186');
  }

  return { KNOWN, byCode, detectCrs };
});
