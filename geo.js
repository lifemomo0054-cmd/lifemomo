'use strict';

// 지도 계산 도우미 (서버에서 씀). 영역이 수 km 안쪽이라 경위도를 평면(미터)으로 펴서 계산한다.

function localMeters(origin) {
  const kx = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  const ky = 110540;
  return {
    forward: ([lat, lng]) => [(lng - origin.lng) * kx, (lat - origin.lat) * ky],
    inverse: ([x, y]) => ({ lat: origin.lat + y / ky, lng: origin.lng + x / kx }),
  };
}

// ring: [[x, y], ...] (닫는 점 없이). 짝홀 규칙이라 선이 서로 꼬여 있어도 동작한다.
function insideRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// points: [[x, y], ...] (평면 좌표)
function bounds(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

// polygon: [[lat, lng], ...] 의 경계 상자 가운데
function centerOf(polygon) {
  const lats = polygon.map((p) => p[0]);
  const lngs = polygon.map((p) => p[1]);
  return { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
}

// polygon: [[lat, lng], ...] → 면적(㎡)
function polygonAreaM2(polygon) {
  const pts = polygon.map(localMeters(centerOf(polygon)).forward);
  let twice = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) twice += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(twice) / 2;
}

// 두 지점 사이 거리(m)
function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

const round6 = (n) => Number(n.toFixed(6));

module.exports = { localMeters, insideRing, distanceToSegment, bounds, centerOf, polygonAreaM2, distanceMeters, round6 };
