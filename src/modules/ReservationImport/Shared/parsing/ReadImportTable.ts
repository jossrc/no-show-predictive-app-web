import { InvalidImportFileException } from '../errors/InvalidImportFileException.js';
import { readCsvTable } from './CsvTableReader.js';
import type { ImportFileLimits, ImportTable } from './ImportTable.js';
import { readXlsxTable } from './XlsxTableReader.js';

export interface UploadedImportFile {
  readonly filename: string;
  readonly data: Uint8Array;
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
/** Libro binario OLE2 (.xls/.xlsb heredado): no admitido. */
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function startsWith(data: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => data[index] === byte);
}

/**
 * Formato por EXTENSIÓN y verificación del CONTENIDO efectivo (firma binaria): un .xlsx debe
 * ser un paquete ZIP de SpreadsheetML y un .csv no puede ser binario. Todo en memoria: el
 * archivo nunca se escribe en disco y se libera al terminar la petición.
 */
export function readImportTable(file: UploadedImportFile, limits: ImportFileLimits): ImportTable {
  const extension = /\.([A-Za-z0-9]+)$/.exec(file.filename.trim())?.[1]?.toLowerCase();
  if (extension !== 'csv' && extension !== 'xlsx') {
    throw new InvalidImportFileException('UNSUPPORTED_FILE_FORMAT');
  }
  if (file.data.byteLength === 0) throw new InvalidImportFileException('EMPTY_FILE');

  const zip = startsWith(file.data, ZIP_SIGNATURE);
  if (startsWith(file.data, OLE2_SIGNATURE)) {
    throw new InvalidImportFileException('UNSUPPORTED_FILE_FORMAT');
  }
  if (extension === 'xlsx') {
    if (!zip) throw new InvalidImportFileException('FILE_CONTENT_MISMATCH');
    return readXlsxTable(file.data, limits.maxRows);
  }
  if (zip || file.data.includes(0)) {
    throw new InvalidImportFileException('FILE_CONTENT_MISMATCH');
  }
  return readCsvTable(file.data, limits.maxRows);
}
