import { parse } from 'csv-parse/sync';
import { InvalidImportFileException } from '../errors/InvalidImportFileException.js';
import { isBlankCell, textCell, type ImportTable, type ImportTableRow } from './ImportTable.js';

const MAX_RECORD_BYTES = 64 * 1024;
const UTF8_BOM = '﻿';

function decodeUtf8(data: Uint8Array): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    return text.startsWith(UTF8_BOM) ? text.slice(1) : text;
  } catch {
    throw new InvalidImportFileException('INVALID_FILE_ENCODING');
  }
}

/** `;` (Excel en configuración regional hispana) o `,` (RFC 4180), según la cabecera. */
function detectDelimiter(text: string): ',' | ';' {
  const header = text.slice(0, text.search(/\r?\n|$/));
  const semicolons = header.split(';').length - 1;
  const commas = header.split(',').length - 1;
  return semicolons > commas ? ';' : ',';
}

/**
 * CSV UTF-8 (con o sin BOM) a tabla neutral. Todo valor es texto: la normalización valida tipos
 * estrictamente, de modo que contenido con apariencia de fórmula nunca se interpreta.
 */
export function readCsvTable(data: Uint8Array, maxRows: number): ImportTable {
  const text = decodeUtf8(data);
  if (text.trim() === '') throw new InvalidImportFileException('EMPTY_FILE');

  let records: Array<{ record: string[]; info: { records: number } }>;
  try {
    records = parse(text, {
      delimiter: detectDelimiter(text),
      bom: false,
      info: true,
      relax_column_count: true,
      skip_empty_lines: true,
      // El tamaño del archivo ya está acotado; se lee completo para no truncar filas en silencio.
      max_record_size: MAX_RECORD_BYTES,
    }) as unknown as Array<{ record: string[]; info: { records: number } }>;
  } catch {
    throw new InvalidImportFileException('INVALID_FILE_STRUCTURE');
  }

  const [header, ...body] = records;
  if (!header) throw new InvalidImportFileException('EMPTY_FILE');
  const rows: ImportTableRow[] = body
    .map((entry) => ({ rowNumber: entry.info.records, cells: entry.record.map(textCell) }))
    .filter((row) => row.cells.some((cell) => !isBlankCell(cell)));
  if (rows.length > maxRows) {
    throw new InvalidImportFileException('TOO_MANY_ROWS', { maxRows });
  }
  return { format: 'CSV', headers: header.record, rows, date1904: false };
}
