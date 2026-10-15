'use strict';

// 전통시장 하루 평균 매출액 페이지
// 서버(/api/sales)가 CSV를 읽어 { labelName, series, rows, yearly } 로 준다.
// 가장 최근 값(큰 숫자) → 요약 칸 → 막대그래프 → 표 → 우리 시장과 견주어 보기 순서로 보여 준다.

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const state = { data: null, series: 0 };

// ── 공통 도우미 ─────────────────────────────────────────────────────────
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

async function request(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('지도 프로그램(까만 창)이 꺼져 있어요. 폴더의 start-windows를 더블클릭해서(또는 npm start로) 다시 켠 뒤 이 페이지를 새로고침하세요.');
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(payload?.error || `서버 응답 오류 (HTTP ${res.status})`);
  return payload;
}

function setStatus(text, kind) {
  const node = $('sales-status');
  node.hidden = !text;
  node.textContent = text || '';
  node.className = `status${kind ? ` ${kind}` : ''}`;
}

const fmt = (v, digits = 1) => Number(v).toLocaleString('ko-KR', { maximumFractionDigits: digits });
const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');
const pct = (r) => `${sign(r)}${fmt(Math.abs(r) * 100)}%`;

// 만원 단위의 큰 금액은 억으로 읽기 쉽게: 143730 → "14억 3,730만원"
function readMan(v) {
  const n = Math.round(v);
  if (Math.abs(n) < 10000) return `${fmt(v)}만원`;
  const eok = Math.trunc(n / 10000);
  const man = Math.abs(n % 10000);
  return man ? `${fmt(eok, 0)}억 ${fmt(man, 0)}만원` : `${fmt(eok, 0)}억원`;
}
// 단위가 만원이면 억 단위 읽기, 아니면 숫자 + 단위
const money = (v, unit) => (unit === '만원' ? readMan(v) : `${fmt(v)}${unit}`);
const labelText = (row) => (state.data.yearly ? `${row.label}년` : row.label);

// 고른 항목의 값이 있는 줄만, 전년(앞 줄) 대비 변화와 함께
function points() {
  const { rows } = state.data;
  const list = [];
  for (const row of rows) {
    const value = row.values[state.series];
    if (value == null) continue;
    const prev = list[list.length - 1];
    const diff = state.data.yearly && prev ? value - prev.value : null;
    list.push({ row, value, diff, rate: diff != null && prev.value ? diff / prev.value : null });
  }
  return list;
}

// ── 그리기 ─────────────────────────────────────────────────────────────
function render() {
  const d = state.data;
  const series = d.series[state.series];
  const unit = series.unit || '';
  const list = points();

  const when = d.dataDate ? ` · 기준일 ${d.dataDate}` : '';
  $('source-text').textContent =
    d.source === 'builtin' ? `처음 받은 자료: ${d.fileName}${when}` : `올린 파일: ${d.fileName}${when}`;
  $('sales-reset').hidden = d.source === 'builtin';
  $('sales-export').disabled = !list.length;

  const select = $('series-select');
  $('series-field').hidden = d.series.length < 2;
  select.replaceChildren(...d.series.map((s, i) => new Option(s.unit ? `${s.name} (${s.unit})` : s.name, String(i))));
  select.value = String(state.series);

  for (const id of ['hero', 'tiles', 'chart-card', 'table-card', 'calc-card']) $(id).hidden = !list.length;
  if (!list.length) {
    setStatus('이 항목에는 값이 없습니다.', 'error');
    return;
  }

  renderHero(list, series, unit);
  renderTiles(list, unit);
  renderChart(list, series, unit);
  renderTable(list, unit);
  renderCalc();
}

// 대표 값: 연도별이면 가장 최근 해, 아니면 "전체·합계" 줄(없으면 첫 줄)
function heroPoint(list) {
  if (state.data.yearly) return list[list.length - 1];
  return list.find((p) => /^(전체|합계|전국|평균)$/.test(p.row.label)) || list[0];
}

function renderHero(list, series, unit) {
  const p = heroPoint(list);
  const what = series.name && !/^(전체|합계)$/.test(series.name) ? `${series.name} ` : '';
  $('hero-label').textContent = `${labelText(p.row)} · ${what}전통시장 한 곳의 하루 평균 매출`;
  $('hero-value').textContent = fmt(p.value);
  $('hero-unit').textContent = unit;
  $('hero-won').textContent = unit === '만원' ? `= 하루 ${fmt(Math.round(p.value * 10000), 0)}원` : '';
  const delta = $('hero-delta');
  delta.replaceChildren();
  if (p.diff != null) {
    const prev = list[list.indexOf(p) - 1];
    delta.append(
      `${labelText(prev.row)}보다 `,
      el('span', 'delta-mark', `${p.diff >= 0 ? '▲' : '▼'} ${fmt(Math.abs(p.diff))}${unit} (${pct(p.rate)})`),
      p.diff >= 0 ? ' 늘었어요' : ' 줄었어요',
    );
  }
}

function tile(label, value, note) {
  const box = el('div', 'sales-tile');
  box.append(el('p', 'tile-label', label), el('p', 'tile-value', value));
  if (note) box.append(el('p', 'tile-note', note));
  return box;
}

function renderTiles(list, unit) {
  const tiles = [];
  const first = list[0];
  const last = list[list.length - 1];
  if (state.data.yearly && list.length >= 2) {
    const years = Number(last.row.label) - Number(first.row.label);
    const total = (last.value - first.value) / first.value;
    tiles.push(tile(`${first.row.label}년 → ${last.row.label}년`, pct(total), `${sign(last.value - first.value)}${fmt(Math.abs(last.value - first.value))}${unit}`));
    if (years > 0 && first.value > 0 && last.value > 0) {
      const cagr = (last.value / first.value) ** (1 / years) - 1;
      tiles.push(tile('한 해 평균 증가율', pct(cagr), `${years}년 동안 해마다 고르게 늘었다고 칠 때`));
    }
    const best = list.filter((p) => p.rate != null).reduce((a, b) => (b.rate > a.rate ? b : a));
    tiles.push(tile('가장 많이 늘어난 해', `${best.row.label}년`, `전년보다 ${sign(best.diff)}${fmt(Math.abs(best.diff))}${unit} (${pct(best.rate)})`));
  } else if (list.length >= 2) {
    const sorted = [...list].sort((a, b) => b.value - a.value);
    tiles.push(tile('가장 많은 곳', sorted[0].row.label, `${fmt(sorted[0].value)}${unit}`));
    tiles.push(tile('가장 적은 곳', sorted[sorted.length - 1].row.label, `${fmt(sorted[sorted.length - 1].value)}${unit}`));
  }
  $('tiles').replaceChildren(...tiles);
  $('tiles').hidden = !tiles.length;
}

// 눈금: 0부터, 1·2·2.5·5 × 10ⁿ 간격으로 4칸 안팎
function niceTicks(max) {
  if (!(max > 0)) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

function renderChart(list, series, unit) {
  const d = state.data;
  $('chart-title').textContent = `${d.yearly ? '연도별' : `${d.labelName}별`} 하루 평균 매출${series.name && !/^(전체|합계)$/.test(series.name) ? ` · ${series.name}` : ''}${unit ? ` (단위: ${unit})` : ''}`;
  $('chart-sub').textContent = `막대에 마우스를 올리거나 눌러 보면 ${d.yearly ? '전년 대비 변화를' : '값을'} 볼 수 있어요.`;

  const box = $('chart');
  const W = Math.max(280, box.clientWidth || 600);
  const H = 260;
  const m = { top: 28, right: 12, bottom: 32, left: 56 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const ticks = niceTicks(Math.max(...list.map((p) => p.value)));
  const top = ticks[ticks.length - 1];
  const y = (v) => m.top + plotH - (Math.max(0, v) / top) * plotH;
  const band = plotW / list.length;
  const barW = Math.min(72, band * 0.56);

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': $('chart-title').textContent });
  const grid = svg('g', { class: 'grid' });
  for (const t of ticks) {
    const ty = y(t);
    if (t > 0) grid.append(svg('line', { x1: m.left, x2: W - m.right, y1: ty, y2: ty }));
    const label = svg('text', { x: m.left - 8, y: ty + 4, 'text-anchor': 'end' });
    label.textContent = fmt(t, 1);
    grid.append(label);
  }
  root.append(grid);

  const axis = svg('g', { class: 'axis-x' });
  const bars = svg('g');
  list.forEach((p, i) => {
    const cx = m.left + band * i + band / 2;
    const x = cx - barW / 2;
    const y0 = m.top + plotH;
    const yt = y(p.value);
    const r = Math.min(4, (y0 - yt) / 2, barW / 2);
    const g = svg('g');
    // 위쪽 모서리만 4px 둥글게, 아래는 기준선에 붙인다
    g.append(svg('path', {
      class: 'bar',
      d: `M${x},${y0}V${yt + r}Q${x},${yt} ${x + r},${yt}H${x + barW - r}Q${x + barW},${yt} ${x + barW},${yt + r}V${y0}Z`,
    }));
    // 가장 최근(마지막) 막대에만 값을 적는다. 나머지는 마우스를 올리거나 표에서 본다.
    if (i === list.length - 1) {
      const v = svg('text', { class: 'bar-label', x: cx, y: yt - 8, 'text-anchor': 'middle' });
      v.textContent = fmt(p.value);
      g.append(v);
    }
    const hit = svg('rect', {
      class: 'hit', x: m.left + band * i, y: m.top, width: band, height: plotH, tabindex: 0,
      'aria-label': `${labelText(p.row)} ${fmt(p.value)}${unit}${p.diff != null ? `, 전년 대비 ${pct(p.rate)}` : ''}`,
    });
    const show = () => showTip(p, unit, g);
    hit.addEventListener('mouseenter', show);
    hit.addEventListener('focus', show);
    hit.addEventListener('click', show);
    hit.addEventListener('mouseleave', hideTip);
    hit.addEventListener('blur', hideTip);
    g.append(hit);
    bars.append(g);

    const t = svg('text', { x: cx, y: H - 10, 'text-anchor': 'middle' });
    t.textContent = labelText(p.row);
    axis.append(t);
  });
  root.append(bars, svg('line', { class: 'baseline', x1: m.left, x2: W - m.right, y1: m.top + plotH, y2: m.top + plotH }), axis);
  box.replaceChildren(root);
}

function showTip(p, unit, group) {
  for (const g of document.querySelectorAll('#chart .is-hover')) g.classList.remove('is-hover');
  group.classList.add('is-hover');
  const tip = $('chart-tip');
  tip.replaceChildren(el('strong', '', labelText(p.row)), el('div', '', `하루 평균 ${fmt(p.value)}${unit}`));
  if (unit === '만원') tip.append(el('div', 'tip-sub', `${fmt(Math.round(p.value * 10000), 0)}원`));
  if (p.diff != null) tip.append(el('div', '', `전년 대비 ${p.diff >= 0 ? '▲' : '▼'} ${fmt(Math.abs(p.diff))}${unit} (${pct(p.rate)})`));
  tip.hidden = false;
  const card = $('chart-card').getBoundingClientRect();
  const bar = group.querySelector('.bar').getBoundingClientRect();
  // 막대를 가리지 않게 오른쪽 옆에, 자리가 없으면 왼쪽 옆에 둔다
  let left = bar.right - card.left + 10;
  if (left + tip.offsetWidth > card.width - 8) left = Math.max(8, bar.left - card.left - tip.offsetWidth - 10);
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(8, bar.top - card.top)}px`;
}

function hideTip() {
  $('chart-tip').hidden = true;
  for (const g of document.querySelectorAll('#chart .is-hover')) g.classList.remove('is-hover');
}

function renderTable(list, unit) {
  const d = state.data;
  const head = [d.yearly ? '연도' : d.labelName, `하루 평균 (${unit || '값'})`];
  if (unit === '만원') head.push('원으로');
  if (d.yearly) head.push(`전년 대비 (${unit || '값'})`, '전년 대비 (%)');
  const thead = el('thead');
  const hr = el('tr');
  for (const h of head) hr.append(el('th', '', h));
  thead.append(hr);
  const tbody = el('tbody');
  for (const p of list) {
    const tr = el('tr');
    tr.append(el('td', '', labelText(p.row)), el('td', '', fmt(p.value)));
    if (unit === '만원') tr.append(el('td', '', `${fmt(Math.round(p.value * 10000), 0)}원`));
    if (d.yearly) {
      tr.append(
        el('td', '', p.diff == null ? '—' : `${sign(p.diff)}${fmt(Math.abs(p.diff))}`),
        el('td', '', p.rate == null ? '—' : pct(p.rate)),
      );
    }
    tbody.append(tr);
  }
  $('sales-table').replaceChildren(thead, tbody);
}

// ── 우리 시장과 견주어 보기 ────────────────────────────────────────────
function renderCalc() {
  const list = points();
  const p = heroPoint(list);
  const unit = state.data.series[state.series].unit || '';
  $('calc-mine-unit').textContent = unit;
  const base = `${labelText(p.row)} 전국 평균(${fmt(p.value)}${unit})`;

  const mineOut = $('calc-mine-out');
  const mine = Number($('calc-mine').value);
  mineOut.replaceChildren();
  if ($('calc-mine').value === '' || !Number.isFinite(mine) || mine < 0) {
    mineOut.textContent = `하루 매출을 넣으면 ${base}과 견주어 보여 줘요.`;
  } else {
    const diff = mine - p.value;
    mineOut.append(
      `${base}의 `,
      el('strong', '', `${fmt((mine / p.value) * 100)}%`),
      diff === 0 ? ' · 평균과 같아요' : ` · 평균보다 ${fmt(Math.abs(diff))}${unit} ${diff > 0 ? '많아요' : '적어요'}`,
    );
  }

  const daysOut = $('calc-days-out');
  const days = Math.round(Number($('calc-days').value));
  daysOut.replaceChildren();
  if (!(days >= 1 && days <= 31)) {
    daysOut.textContent = '1~31 사이의 날 수를 넣어 주세요.';
  } else {
    daysOut.append(
      `평균 시장이 한 달에 ${days}일 열면 한 달 약 `,
      el('strong', '', money(p.value * days, unit)),
      `, 한 해 약 ${money(p.value * days * 12, unit)} (어림)`,
    );
  }
}

// ── 엑셀로 저장 ───────────────────────────────────────────────────────
async function exportXlsx() {
  const d = state.data;
  const header = [d.yearly ? '연도' : d.labelName];
  const hasDate = d.rows.some((r) => r.date);
  if (hasDate) header.push('데이터 기준일자');
  for (const s of d.series) {
    const u = s.unit ? ` (${s.unit})` : '';
    header.push(`${s.name}${u}`);
    if (d.yearly) header.push(`${s.name} 전년 대비${u}`, `${s.name} 전년 대비 (%)`);
  }
  const prev = d.series.map(() => null);
  const rows = d.rows.map((r) => {
    const cells = [r.label];
    if (hasDate) cells.push(r.date);
    r.values.forEach((v, k) => {
      cells.push(v ?? '');
      if (d.yearly) {
        const before = prev[k];
        cells.push(v != null && before != null ? Math.round((v - before) * 100) / 100 : '');
        cells.push(v != null && before ? { value: (v - before) / before, style: 'percent' } : '');
        if (v != null) prev[k] = v;
      }
    });
    return cells;
  });
  const info = [
    ['항목', '내용'],
    ['자료', d.fileName],
    ['기준일', d.dataDate || ''],
    ['뜻', '전국 전통시장 한 곳의 하루 평균 매출액 (소상공인시장진흥공단 전통시장 실태조사)'],
    ['주의', '시장별·지역별 값이 아닌 전국 평균입니다.'],
  ];
  try {
    const bytes = await Xlsx.build([
      { name: '하루 평균 매출', rows: [header, ...rows], widths: header.map((h, i) => (i === 0 ? 10 : Math.max(12, h.length * 2))), header: true },
      { name: '정보', rows: info, widths: [10, 70], header: true },
    ]);
    const day = new Date();
    const stamp = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`;
    const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_TYPE }));
    const link = el('a');
    link.href = url;
    link.download = `전통시장 하루 평균 매출액_${stamp}.xlsx`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    setStatus(`엑셀 파일을 만들지 못했습니다: ${err.message}`, 'error');
  }
}

// ── 불러오기 · 올리기 ──────────────────────────────────────────────────
function show(data) {
  state.data = data;
  state.series = 0;
  render();
}

async function load() {
  setStatus('자료를 불러오는 중…', 'loading');
  try {
    show(await request('/api/sales'));
    setStatus('');
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

async function upload(file) {
  setStatus(`${file.name} 읽는 중…`, 'loading');
  try {
    const data = await request(`/api/sales/upload?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    });
    show(data);
    setStatus(`${file.name}을(를) 읽었어요. 다음에 열어도 이 파일로 보여 줘요.`);
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

$('sales-input').addEventListener('change', (e) => {
  const [file] = e.target.files;
  e.target.value = '';
  if (file) upload(file);
});
$('sales-reset').addEventListener('click', async () => {
  setStatus('처음 자료로 되돌리는 중…', 'loading');
  try {
    show(await request('/api/sales/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
    setStatus('');
  } catch (err) {
    setStatus(err.message, 'error');
  }
});
$('sales-export').addEventListener('click', exportXlsx);
$('series-select').addEventListener('change', (e) => {
  state.series = Number(e.target.value);
  hideTip();
  render();
});
$('calc-mine').addEventListener('input', renderCalc);
$('calc-days').addEventListener('input', renderCalc);

let lastWidth = 0;
new ResizeObserver(() => {
  const w = $('chart').clientWidth;
  if (state.data && w && w !== lastWidth) {
    lastWidth = w;
    hideTip();
    renderChart(points(), state.data.series[state.series], state.data.series[state.series].unit || '');
  }
}).observe($('chart'));

load();
