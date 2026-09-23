'use strict';

// 엑셀(.xlsx) 파일을 만드는 작은 모듈. xlsx는 XML 파일 몇 개를 ZIP으로 묶은 것이라
// Shapefile.zip 을 그대로 쓴다. 브라우저에서는 window.Xlsx, Node(테스트)에서는 require 로 쓴다.
//
// sheets: [{ name, rows, widths?, header?, autoFilter? }]
//   rows 의 각 칸은 문자열, 숫자, 또는 { value, style: 'bold' | 'percent' }.
//   행 전체를 굵게 하려면 { bold: true, cells: [...] } 로 넣는다.
//   header: 첫 행을 굵게 하고 스크롤해도 보이게 고정한다.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shapefile.js'));
  else root.Xlsx = factory(root.Shapefile);
})(typeof self !== 'undefined' ? self : this, function (Shapefile) {
  const STYLE = { normal: 0, bold: 1, percent: 2 };
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  async function build(sheets) {
    const named = uniqueSheetNames(sheets);
    const text = new TextEncoder();
    const files = [
      { name: '[Content_Types].xml', xml: contentTypes(named.length) },
      { name: '_rels/.rels', xml: rootRels() },
      { name: 'xl/workbook.xml', xml: workbook(named) },
      { name: 'xl/_rels/workbook.xml.rels', xml: workbookRels(named.length) },
      { name: 'xl/styles.xml', xml: styles() },
      ...named.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, xml: worksheet(sheet, i === 0) })),
    ];
    return Shapefile.zip(files.map((f) => ({ name: f.name, data: text.encode(f.xml) })));
  }

  // 시트 이름: 31자 이하, []:*?/\ 불가, 서로 달라야 한다.
  function uniqueSheetNames(sheets) {
    const used = new Set();
    return sheets.map((sheet) => {
      const base = String(sheet.name || '시트').replace(/[[\]:*?/\\]/g, '·').slice(0, 31) || '시트';
      let name = base;
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)}_${n}`;
      used.add(name.toLowerCase());
      return { ...sheet, name };
    });
  }

  function contentTypes(sheetCount) {
    const sheets = Array.from(
      { length: sheetCount },
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    ).join('');
    return (
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      `${sheets}</Types>`
    );
  }

  function rootRels() {
    return (
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    );
  }

  function workbook(sheets) {
    const list = sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
    const filters = sheets
      .map((s, i) => (s.autoFilter && s.rows.length ? filterName(s, i) : ''))
      .join('');
    return (
      `${XML_HEAD}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets>${list}</sheets>` +
      `${filters ? `<definedNames>${filters}</definedNames>` : ''}</workbook>`
    );
  }

  function filterName(sheet, index) {
    const ref = filterRange(sheet).replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');
    const quoted = `'${sheet.name.replace(/'/g, "''")}'`;
    return `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">${escapeXml(`${quoted}!${ref}`)}</definedName>`;
  }

  function workbookRels(sheetCount) {
    const sheets = Array.from(
      { length: sheetCount },
      (_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    ).join('');
    return (
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets}` +
      `<Relationship Id="rId${sheetCount + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`
    );
  }

  function styles() {
    const font = (bold) => `<font>${bold ? '<b/>' : ''}<sz val="11"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font>`;
    return (
      `${XML_HEAD}<styleSheet xmlns="${MAIN_NS}">` +
      `<fonts count="2">${font(false)}${font(true)}</fonts>` +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="3">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
    );
  }

  function worksheet(sheet, selected) {
    const freeze = sheet.header && sheet.rows.length > 1;
    const view =
      `<sheetViews><sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ''}>` +
      `${freeze ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews>`;
    const cols = sheet.widths && sheet.widths.length
      ? `<cols>${sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
      : '';
    const rows = sheet.rows
      .map((row, r) => {
        const cells = Array.isArray(row) ? row : row.cells;
        const bold = (sheet.header && r === 0) || (!Array.isArray(row) && row.bold);
        return `<row r="${r + 1}">${cells.map((cell, c) => cellXml(cell, `${columnName(c)}${r + 1}`, bold)).join('')}</row>`;
      })
      .join('');
    const filter = sheet.autoFilter && sheet.rows.length ? `<autoFilter ref="${filterRange(sheet)}"/>` : '';
    return `${XML_HEAD}<worksheet xmlns="${MAIN_NS}">${view}<sheetFormatPr defaultRowHeight="16.5"/>${cols}<sheetData>${rows}</sheetData>${filter}</worksheet>`;
  }

  function filterRange(sheet) {
    const width = Math.max(...sheet.rows.map((row) => (Array.isArray(row) ? row : row.cells).length), 1);
    return `A1:${columnName(width - 1)}${sheet.rows.length}`;
  }

  function cellXml(cell, ref, bold) {
    const { value, style } = cell !== null && typeof cell === 'object' ? cell : { value: cell, style: '' };
    const s = STYLE[style] || (bold ? STYLE.bold : STYLE.normal);
    const styleAttr = s ? ` s="${s}"` : '';
    if (value == null || value === '') return s ? `<c r="${ref}"${styleAttr}/>` : '';
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${styleAttr}><v>${value}</v></c>`;
    return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
  }

  function columnName(index) {
    let name = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    return name;
  }

  function escapeXml(text) {
    return text
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '') // XML에 넣을 수 없는 글자
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { build };
});
