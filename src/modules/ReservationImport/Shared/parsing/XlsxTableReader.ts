import { strFromU8, unzipSync, type UnzipFileInfo } from 'fflate';
import { InvalidImportFileException } from '../errors/InvalidImportFileException.js';
import { isBlankCell, textCell, type ImportCell, type ImportTable } from './ImportTable.js';

/** Límites anti zip-bomb: entradas del paquete y bytes descomprimidos en total. */
const MAX_ZIP_ENTRIES = 500;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

const WORKBOOK_PATH = 'xl/workbook.xml';
const WORKBOOK_RELS_PATH = 'xl/_rels/workbook.xml.rels';
const SHARED_STRINGS_PATH = 'xl/sharedStrings.xml';
const CONTENT_TYPES_PATH = '[Content_Types].xml';
const SPREADSHEET_MAIN =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';

const structureError = () => new InvalidImportFileException('INVALID_FILE_STRUCTURE');

function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)(?:\\w+:)?${name}\\s*=\\s*"([^"]*)"`).exec(attributes);
  return match ? decodeXmlText(match[1] ?? '') : null;
}

/** Texto de un <si>/<is>: concatena las corridas <t>, sin la guía fonética <rPh>. */
function richText(xml: string): string {
  const withoutPhonetic = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
  return [...withoutPhonetic.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)]
    .map((match) => decodeXmlText(match[1] ?? ''))
    .join('');
}

function columnIndex(reference: string | null, fallback: number): number {
  const letters = reference ? /^([A-Z]+)/.exec(reference)?.[1] : undefined;
  if (!letters) return fallback;
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function unpack(data: Uint8Array): { files: Record<string, Uint8Array>; names: string[] } {
  const names: string[] = [];
  let uncompressed = 0;
  const wanted = (name: string) =>
    name === CONTENT_TYPES_PATH ||
    name === WORKBOOK_PATH ||
    name === WORKBOOK_RELS_PATH ||
    name === SHARED_STRINGS_PATH ||
    /^xl\/worksheets\/[^/]+\.xml$/.test(name);
  try {
    const files = unzipSync(data, {
      filter: (file: UnzipFileInfo) => {
        names.push(file.name);
        uncompressed += file.originalSize;
        if (names.length > MAX_ZIP_ENTRIES || uncompressed > MAX_UNCOMPRESSED_BYTES) {
          throw structureError();
        }
        return wanted(file.name);
      },
    });
    return { files, names };
  } catch (error) {
    if (error instanceof InvalidImportFileException) throw error;
    throw structureError();
  }
}

function assertSafePackage(names: readonly string[], contentTypes: string): void {
  if (
    names.some((name) => /(^|\/)vbaProject\.bin$/i.test(name)) ||
    /macroEnabled/i.test(contentTypes)
  ) {
    throw new InvalidImportFileException('SPREADSHEET_MACROS_NOT_ALLOWED');
  }
  if (names.some((name) => /^xl\/(externalLinks\/|connections\.xml$|queryTables\/)/i.test(name))) {
    throw new InvalidImportFileException('SPREADSHEET_EXTERNAL_CONTENT_NOT_ALLOWED');
  }
  if (!contentTypes.includes(SPREADSHEET_MAIN)) throw structureError();
}

/** Ruta de la PRIMERA hoja del libro según workbook.xml y sus relaciones. */
function firstSheetPath(workbook: string, relationships: string): string {
  const sheet = /<(?:\w+:)?sheet\b([^>]*)\/?>/.exec(workbook);
  const relationId = sheet ? attribute(sheet[1] ?? '', 'id') : null;
  if (!relationId) throw structureError();
  for (const match of relationships.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)) {
    const attributes = match[1] ?? '';
    if (attribute(attributes, 'Id') !== relationId) continue;
    if (attribute(attributes, 'TargetMode') === 'External') throw structureError();
    const target = attribute(attributes, 'Target') ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(path)) throw structureError();
    return path;
  }
  throw structureError();
}

function readCell(attributes: string, body: string, sharedStrings: readonly string[]): ImportCell {
  const type = attribute(attributes, 't') ?? 'n';
  const value = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body)?.[1];
  switch (type) {
    case 's': {
      const text = sharedStrings[Number(value)];
      if (value === undefined || !/^\d+$/.test(value) || text === undefined) throw structureError();
      return textCell(text);
    }
    case 'inlineStr':
      return textCell(richText(body));
    case 'b':
      return textCell(value === '1' ? 'TRUE' : 'FALSE');
    case 'n':
      return value === undefined ? textCell('') : { kind: 'number', raw: value.trim() };
    default:
      // str, d (fecha ISO) y e (error) se tratan como texto; un error nunca supera la validación.
      return textCell(decodeXmlText(value ?? ''));
  }
}

/**
 * Lee la primera hoja de un .xlsx sin ejecutar nada: no evalúa fórmulas (si existen se rechaza
 * el archivo), rechaza macros, vínculos y conexiones externas, y limita la descompresión.
 */
export function readXlsxTable(data: Uint8Array, maxRows: number): ImportTable {
  const { files, names } = unpack(data);
  const contentTypes = files[CONTENT_TYPES_PATH];
  const workbook = files[WORKBOOK_PATH];
  const relationships = files[WORKBOOK_RELS_PATH];
  if (!contentTypes || !workbook || !relationships) throw structureError();
  assertSafePackage(names, strFromU8(contentTypes));

  const workbookXml = strFromU8(workbook);
  const sheet = files[firstSheetPath(workbookXml, strFromU8(relationships))];
  if (!sheet) throw structureError();
  const sheetXml = strFromU8(sheet);
  if (/<(?:\w+:)?f\b/.test(sheetXml)) {
    throw new InvalidImportFileException('SPREADSHEET_FORMULAS_NOT_ALLOWED');
  }

  const sharedXml = files[SHARED_STRINGS_PATH] ? strFromU8(files[SHARED_STRINGS_PATH]) : '';
  const sharedStrings = [
    ...sharedXml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\b[^>]*\/>/g),
  ].map((match) => richText(match[1] ?? ''));

  const table: Array<{ rowNumber: number; cells: (ImportCell | null)[] }> = [];
  let fallbackRow = 0;
  for (const row of sheetXml.matchAll(
    /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g,
  )) {
    fallbackRow += 1;
    const rowNumber = Number(attribute(row[1] ?? '', 'r') ?? fallbackRow);
    if (!Number.isSafeInteger(rowNumber) || rowNumber < 1) throw structureError();
    fallbackRow = rowNumber;
    const cells: (ImportCell | null)[] = [];
    let position = 0;
    for (const cell of (row[2] ?? '').matchAll(
      /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g,
    )) {
      const attributes = cell[1] ?? '';
      const index = columnIndex(attribute(attributes, 'r'), position);
      cells[index] = readCell(attributes, cell[2] ?? '', sharedStrings);
      position = index + 1;
    }
    if (cells.some((cell) => !isBlankCell(cell))) {
      table.push({ rowNumber, cells: Array.from(cells, (cell) => cell ?? null) });
    }
    if (table.length > maxRows + 1) {
      throw new InvalidImportFileException('TOO_MANY_ROWS', { maxRows });
    }
  }

  const [header, ...rows] = table;
  if (!header) throw new InvalidImportFileException('EMPTY_FILE');
  return {
    format: 'XLSX',
    headers: header.cells.map((cell) =>
      cell === null ? '' : cell.kind === 'text' ? cell.text : cell.raw,
    ),
    rows,
    date1904: /<(?:\w+:)?workbookPr\b[^>]*\bdate1904\s*=\s*"(1|true)"/.test(workbookXml),
  };
}
