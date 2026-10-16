import { strToU8, unzipSync, zipSync } from 'fflate';

/*
 * Minimal .xlsx reader / writer (an .xlsx file is a ZIP of XML parts).
 * Reads cell values only - no formulas are evaluated, no macros, no external
 * links - so an uploaded workbook can never run anything. Browser only: XML
 * is parsed with DOMParser, which never fetches external entities.
 */

export type Sheet = { headers: string[]; rows: Record<string, string>[] };

const MAX_FILE_BYTES = 10 * 1024 * 1024; // the .xlsx itself
const MAX_PART_BYTES = 40 * 1024 * 1024; // any single XML part once unzipped (zip-bomb guard)
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export class WorkbookError extends Error {}

function xml(bytes: Uint8Array | undefined): Document | null {
  if (!bytes) return null;
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
  return doc.getElementsByTagName('parsererror').length > 0 ? null : doc;
}

const byTag = (node: Element | Document, tag: string) => Array.from(node.getElementsByTagNameNS('*', tag));

/** "BC12" -> 54 (zero-based column index). */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Text of a shared string or inline string, including rich-text runs. */
const textOf = (node: Element) => byTag(node, 't').map((t) => t.textContent ?? '').join('');

/** Workbook -> { lower-cased sheet name: rows keyed by lower-cased header }. */
export function readWorkbook(bytes: Uint8Array): Record<string, Sheet> {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new WorkbookError('too-large');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        const wanted = file.name.startsWith('xl/') && (file.name.endsWith('.xml') || file.name.endsWith('.rels'));
        if (!wanted) return false; // images, macros, embedded objects: never extracted
        if (file.originalSize > MAX_PART_BYTES) throw new WorkbookError('too-large');
        return true;
      },
    });
  } catch (error) {
    throw error instanceof WorkbookError ? error : new WorkbookError('not-xlsx');
  }

  const workbook = xml(files['xl/workbook.xml']);
  const rels = xml(files['xl/_rels/workbook.xml.rels']);
  if (!workbook || !rels) throw new WorkbookError('not-xlsx');

  const targets = new Map(byTag(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target') ?? '']));
  const shared = xml(files['xl/sharedStrings.xml']);
  const strings = shared ? byTag(shared, 'si').map(textOf) : [];

  const sheets: Record<string, Sheet> = {};
  for (const sheet of byTag(workbook, 'sheet')) {
    const name = (sheet.getAttribute('name') ?? '').trim().toLowerCase();
    const target = targets.get(sheet.getAttributeNS(NS_REL, 'id') ?? sheet.getAttribute('r:id')) ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const doc = xml(files[path]);
    if (!name || !doc) continue;

    const grid: string[][] = [];
    for (const row of byTag(doc, 'row')) {
      const values: string[] = [];
      let next = 0;
      for (const cell of byTag(row, 'c')) {
        const ref = cell.getAttribute('r');
        const col = ref ? columnIndex(ref) : next;
        next = col + 1;
        const type = cell.getAttribute('t');
        const v = byTag(cell, 'v')[0]?.textContent ?? '';
        let value = v;
        if (type === 's') value = strings[Number(v)] ?? '';
        else if (type === 'inlineStr') value = textOf(cell);
        else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else if (type === 'e') value = '';
        values[col] = value.trim();
      }
      if (values.some((value) => value)) grid.push(Array.from(values, (value) => value ?? ''));
    }

    const [header = [], ...body] = grid;
    const headers = header.map((h) => h.trim().toLowerCase());
    sheets[name] = {
      headers,
      rows: body.map((cells): Record<string, string> => Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']))),
    };
  }
  return sheets;
}

/**
 * Excel stores dates typed into a cell as day numbers (1 = 1900-01-01, with
 * the historic 1900 leap-year bug). Turns those into YYYY-MM-DD; text such as
 * "2026-08-31" is passed through unchanged.
 */
export function excelDate(value: string): string {
  if (!/^\d+(\.\d+)?$/.test(value)) return value;
  const serial = Math.floor(Number(value));
  if (serial < 60 || serial > 2958465) return value;
  const ms = Date.UTC(1899, 11, 30) + serial * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Builds a workbook where every cell is text (so IDs keep leading zeros). */
export function writeWorkbook(sheets: { name: string; rows: string[][] }[]): Uint8Array {
  const sheetXml = (rows: string[][]) =>
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    rows
      .map(
        (cells, r) =>
          `<row r="${r + 1}">` +
          cells
            .map((c, i) => `<c r="${columnName(i)}${r + 1}" t="inlineStr" s="1"><is><t xml:space="preserve">${escapeXml(c)}</t></is></c>`)
            .join('') +
          '</row>',
      )
      .join('') +
    '</sheetData></worksheet>';

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join('') +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
          .join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>',
    ),
    // Style 1 = "Text" number format (@), so typing 0012 or 2026-08-31 stays as written.
    'xl/styles.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>',
    ),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.rows));
  });
  return zipSync(files, { level: 6 });
}
