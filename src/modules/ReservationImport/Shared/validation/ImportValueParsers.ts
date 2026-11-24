import { DECIMAL_ID_PATTERN } from '../../../../shared/identifiers/DecimalId.js';
import { parseLocalDate, type LocalDate } from '../../../../shared/time/LimaTime.js';
import type { ImportCell } from '../parsing/ImportTable.js';

/**
 * Conversión estricta celda → tipo del dominio. Devuelve `undefined` si la celda está vacía y
 * `null` si el valor es inválido. Los identificadores NUNCA pasan por Number: un número de Excel
 * con exponente o decimales (precisión ya perdida) se rechaza.
 */
const DECIMAL_ID = new RegExp(DECIMAL_ID_PATTERN);
const CLINIC_ID = /^[1-9][0-9]{0,8}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LATAM_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const DATE_TIME = /^(\S+)[ T](\d{1,2}:\d{2}(?::\d{2})?)$/;
const SECONDS_PER_DAY = 86_400;
const MS_PER_DAY = 86_400_000;

export interface LocalTime {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export interface LocalDateTime {
  readonly date: LocalDate;
  readonly time: LocalTime;
}

export function cellText(cell: ImportCell | null | undefined): string | undefined {
  if (cell === null || cell === undefined) return undefined;
  const text = (cell.kind === 'text' ? cell.text : cell.raw).trim();
  return text === '' ? undefined : text;
}

export function parseDecimalId(cell: ImportCell | null | undefined): string | null | undefined {
  const text = cellText(cell);
  if (text === undefined) return undefined;
  return DECIMAL_ID.test(text) ? text : null;
}

export function parseClinicId(cell: ImportCell | null | undefined): number | null | undefined {
  const text = cellText(cell);
  if (text === undefined) return undefined;
  return CLINIC_ID.test(text) ? Number(text) : null;
}

/** Indicadores booleanos de FLOWww: 0 = no, -1 = sí. */
export function parseFlowFlag(cell: ImportCell | null | undefined): 0 | -1 | null | undefined {
  const text = cellText(cell);
  if (text === undefined) return undefined;
  return text === '0' ? 0 : text === '-1' ? -1 : null;
}

export function parseCount(
  cell: ImportCell | null | undefined,
  max: number,
): number | null | undefined {
  const text = cellText(cell);
  if (text === undefined) return undefined;
  if (!/^\d{1,9}$/.test(text)) return null;
  const value = Number(text);
  return value <= max ? value : null;
}

export function parseIdList(
  cell: ImportCell | null | undefined,
  separator: string,
  maxItems: number,
): string[] | null | undefined {
  const text = cellText(cell);
  if (text === undefined) return undefined;
  const items = text.split(separator).map((item) => item.trim());
  if (items.length > maxItems || items.some((item) => !DECIMAL_ID.test(item))) return null;
  return items;
}

/** Serie de Excel (días desde 1899-12-30, o 1904-01-01) a fecha y segundos del día. */
function excelSerial(raw: string, date1904: boolean): { date: LocalDate; seconds: number } | null {
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const totalSeconds = Math.round(Number(raw) * SECONDS_PER_DAY);
  if (!Number.isSafeInteger(totalSeconds) || totalSeconds < SECONDS_PER_DAY) return null;
  const days = Math.floor(totalSeconds / SECONDS_PER_DAY);
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const day = new Date(epoch + days * MS_PER_DAY);
  return {
    date: { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() },
    seconds: totalSeconds - days * SECONDS_PER_DAY,
  };
}

function timeFromSeconds(seconds: number): LocalTime {
  return {
    hour: Math.floor(seconds / 3600),
    minute: Math.floor((seconds % 3600) / 60),
    second: seconds % 60,
  };
}

function parseDateText(text: string): LocalDate | null {
  const iso = ISO_DATE.exec(text);
  if (iso) return parseLocalDate(text);
  const latam = LATAM_DATE.exec(text);
  return latam ? parseLocalDate(`${latam[3]}-${latam[2]}-${latam[1]}`) : null;
}

function parseTimeText(text: string): LocalTime | null {
  const match = TIME.exec(text);
  if (!match) return null;
  const time = { hour: Number(match[1]), minute: Number(match[2]), second: Number(match[3] ?? 0) };
  return time.hour < 24 && time.minute < 60 && time.second < 60 ? time : null;
}

export function parseDate(
  cell: ImportCell | null | undefined,
  date1904: boolean,
): LocalDate | null | undefined {
  const text = cellText(cell);
  if (text === undefined) return undefined;
  if (cell?.kind === 'number') {
    const serial = excelSerial(text, date1904);
    return serial && serial.seconds === 0 ? serial.date : null;
  }
  return parseDateText(text);
}

export function parseTime(cell: ImportCell | null | undefined): LocalTime | null | undefined {
  const text = cellText(cell);
  if (text === undefined) return undefined;
  if (cell?.kind === 'number') {
    // Hora de Excel: fracción de día en [0, 1).
    if (!/^0(\.\d+)?$/.test(text)) return null;
    const seconds = Math.round(Number(text) * SECONDS_PER_DAY);
    return seconds < SECONDS_PER_DAY ? timeFromSeconds(seconds) : null;
  }
  return parseTimeText(text);
}

export function parseDateTime(
  cell: ImportCell | null | undefined,
  date1904: boolean,
): LocalDateTime | null | undefined {
  const text = cellText(cell);
  if (text === undefined) return undefined;
  if (cell?.kind === 'number') {
    const serial = excelSerial(text, date1904);
    return serial ? { date: serial.date, time: timeFromSeconds(serial.seconds) } : null;
  }
  const match = DATE_TIME.exec(text);
  const date = match ? parseDateText(match[1] ?? '') : null;
  const time = match ? parseTimeText(match[2] ?? '') : null;
  return date && time ? { date, time } : null;
}
