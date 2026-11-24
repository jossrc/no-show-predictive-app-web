import { createHash } from 'node:crypto';
import { limaLocalToInstant } from '../../../../shared/time/LimaTime.js';
import {
  IMPORT_COLUMNS,
  MAX_RESCHEDULE_COUNT,
  MAX_SERVICE_LINES,
  REQUIRED_IMPORT_FIELDS,
  RESERVATION_IMPORT_CONTRACT_VERSION,
  SERVICE_LIST_SEPARATOR,
  type ImportField,
  type RowRejectionCode,
} from '../contract/ReservationImportContract.js';
import { InvalidImportFileException } from '../errors/InvalidImportFileException.js';
import type {
  ImportedReservationDraft,
  RowRejection,
  RowRejectionError,
} from '../models/ImportedReservation.js';
import { isBlankCell, type ImportTable, type ImportTableRow } from '../parsing/ImportTable.js';
import {
  cellText,
  parseClinicId,
  parseCount,
  parseDate,
  parseDateTime,
  parseDecimalId,
  parseFlowFlag,
  parseIdList,
  parseTime,
  type LocalTime,
} from './ImportValueParsers.js';

/** Tag 16 de FLOWww = borrador (misma expresión que la fuente: sin coincidencias parciales). */
const DRAFT_TAG = /(^|[^0-9])16([^0-9]|$)/;

export interface ResolvedImportColumns {
  readonly indexes: Readonly<Partial<Record<ImportField, number>>>;
  /** Columnas no contractuales: se ignoran y no se almacenan (p. ej., datos de contacto). */
  readonly ignoredColumns: readonly string[];
}

export interface NormalizedImportRows {
  readonly drafts: readonly ImportedReservationDraft[];
  readonly rejections: readonly RowRejection[];
  readonly ignoredColumns: readonly string[];
}

/** Cabeceras sin distinguir mayúsculas ni espacios exteriores; faltantes o repetidas ⇒ 422. */
export function resolveImportColumns(headers: readonly string[]): ResolvedImportColumns {
  const byName = new Map(
    (Object.entries(IMPORT_COLUMNS) as Array<[ImportField, string]>).map(([field, column]) => [
      column.toLowerCase(),
      field,
    ]),
  );
  const indexes: Partial<Record<ImportField, number>> = {};
  const ignored: string[] = [];
  const duplicated = new Set<string>();
  headers.forEach((raw, index) => {
    const header = raw.replace(/^﻿/, '').trim();
    const field = byName.get(header.toLowerCase());
    if (!field) {
      if (header !== '') ignored.push(header.slice(0, 64));
      return;
    }
    if (indexes[field] !== undefined) duplicated.add(IMPORT_COLUMNS[field]);
    indexes[field] = index;
  });

  if (duplicated.size > 0) {
    throw new InvalidImportFileException('DUPLICATE_COLUMNS', { columns: [...duplicated] });
  }
  const missing = REQUIRED_IMPORT_FIELDS.filter((field) => indexes[field] === undefined);
  if (missing.length > 0) {
    throw new InvalidImportFileException('MISSING_REQUIRED_COLUMNS', {
      columns: missing.map((field) => IMPORT_COLUMNS[field]),
    });
  }
  return { indexes, ignoredColumns: ignored };
}

function rowHash(draft: Omit<ImportedReservationDraft, 'rowHash' | 'rowNumber'>): string {
  const canonical = JSON.stringify([
    RESERVATION_IMPORT_CONTRACT_VERSION,
    draft.reservationId,
    draft.clientId,
    draft.clinicId,
    draft.appointmentAt.toISOString(),
    draft.appointmentEndAt?.toISOString() ?? null,
    draft.bookingCreatedAt.toISOString(),
    draft.status,
    draft.fwaFlag,
    draft.rescheduleCount,
    draft.serviceProductIds,
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

class RowReader {
  readonly errors: RowRejectionError[] = [];

  constructor(
    private readonly row: ImportTableRow,
    private readonly columns: ResolvedImportColumns,
  ) {}

  cell(field: ImportField) {
    const index = this.columns.indexes[field];
    return index === undefined ? undefined : this.row.cells[index];
  }

  fail(code: RowRejectionCode, field: ImportField | null): void {
    this.errors.push({ code, field: field === null ? null : IMPORT_COLUMNS[field] });
  }

  /** Aplica el parser; vacío en un campo obligatorio ⇒ REQUIRED_VALUE_MISSING. */
  read<T>(
    field: ImportField,
    parse: (cell: ReturnType<RowReader['cell']>) => T | null | undefined,
    invalid: RowRejectionCode,
    required: boolean,
  ): T | null {
    const value = parse(this.cell(field));
    if (value === undefined) {
      if (required) this.fail('REQUIRED_VALUE_MISSING', field);
      return null;
    }
    if (value === null) this.fail(invalid, field);
    return value;
  }
}

function toInstant(date: Parameters<typeof limaLocalToInstant>[0], time: LocalTime): Date {
  return limaLocalToInstant(date, time.hour, time.minute, time.second);
}

function normalizeRow(
  row: ImportTableRow,
  table: ImportTable,
  columns: ResolvedImportColumns,
  now: Date,
): { draft: ImportedReservationDraft | null; rejection: RowRejection | null } {
  const reader = new RowReader(row, columns);
  const { date1904 } = table;
  if (row.cells.slice(table.headers.length).some((cell) => !isBlankCell(cell))) {
    reader.fail('INVALID_COLUMN_COUNT', null);
  }

  const reservationId = reader.read('reservationId', parseDecimalId, 'INVALID_IDENTIFIER', true);
  const clientId = reader.read('clientId', parseDecimalId, 'INVALID_IDENTIFIER', true);
  const clinicId = reader.read('clinicId', parseClinicId, 'INVALID_CLINIC_ID', true);
  const date = reader.read('appointmentDate', (c) => parseDate(c, date1904), 'INVALID_DATE', true);
  const start = reader.read('appointmentStart', parseTime, 'INVALID_TIME', true);
  const end = reader.read('appointmentEnd', parseTime, 'INVALID_TIME', false);
  const created = reader.read(
    'bookingCreatedAt',
    (c) => parseDateTime(c, date1904),
    'INVALID_DATETIME',
    true,
  );
  const notAttended = reader.read('notAttendedFlag', parseFlowFlag, 'INVALID_FLAG', true);
  const fwaFlag = reader.read('fwaFlag', parseFlowFlag, 'INVALID_FLAG', false);
  const services = reader.read(
    'serviceProductIds',
    (c) => parseIdList(c, SERVICE_LIST_SEPARATOR, MAX_SERVICE_LINES),
    'INVALID_SERVICE_LIST',
    true,
  );
  const rescheduleCount = reader.read(
    'rescheduleCount',
    (c) => parseCount(c, MAX_RESCHEDULE_COUNT),
    'INVALID_RESCHEDULE_COUNT',
    true,
  );
  const delayed = reader.read('delayedFlag', parseFlowFlag, 'INVALID_FLAG', false);
  const locked = reader.read('lockedFlag', parseFlowFlag, 'INVALID_FLAG', false);
  const tags = cellText(reader.cell('tags'));
  if (delayed === -1 || locked === -1 || (tags !== undefined && DRAFT_TAG.test(tags))) {
    reader.fail('NOT_A_RESERVATION', null);
  }

  const appointmentAt = date && start ? toInstant(date, start) : null;
  const appointmentEndAt = date && end ? toInstant(date, end) : null;
  const bookingCreatedAt = created ? toInstant(created.date, created.time) : null;
  if (appointmentAt && appointmentEndAt && appointmentEndAt < appointmentAt) {
    reader.fail('END_BEFORE_START', 'appointmentEnd');
  }
  if (appointmentAt && appointmentAt.getTime() <= now.getTime()) {
    reader.fail('APPOINTMENT_NOT_FUTURE', 'appointmentDate');
  }
  if (bookingCreatedAt && bookingCreatedAt.getTime() > now.getTime()) {
    reader.fail('BOOKING_CREATED_IN_FUTURE', 'bookingCreatedAt');
  }
  if (appointmentAt && bookingCreatedAt && bookingCreatedAt >= appointmentAt) {
    reader.fail('BOOKING_NOT_BEFORE_APPOINTMENT', 'bookingCreatedAt');
  }

  if (
    reader.errors.length > 0 ||
    reservationId === null ||
    clientId === null ||
    clinicId === null ||
    appointmentAt === null ||
    bookingCreatedAt === null ||
    notAttended === null ||
    services === null ||
    rescheduleCount === null
  ) {
    return {
      draft: null,
      rejection: { rowNumber: row.rowNumber, reservationId, errors: reader.errors },
    };
  }

  const content = {
    reservationId,
    clientId,
    clinicId,
    appointmentAt,
    appointmentEndAt,
    bookingCreatedAt,
    status: notAttended === -1 ? ('CANCELLED' as const) : ('SCHEDULED' as const),
    fwaFlag,
    rescheduleCount,
    serviceProductIds: services,
  };
  return {
    draft: { rowNumber: row.rowNumber, ...content, rowHash: rowHash(content) },
    rejection: null,
  };
}

/**
 * Duplicados dentro del archivo: copias idénticas ⇒ se conserva la primera; mismo ID con datos
 * distintos ⇒ todas las ocurrencias se rechazan (no se elige una arbitrariamente).
 */
function separateFileDuplicates(drafts: readonly ImportedReservationDraft[]): NormalizedImportRows {
  const byId = new Map<string, ImportedReservationDraft[]>();
  for (const draft of drafts) {
    byId.set(draft.reservationId, [...(byId.get(draft.reservationId) ?? []), draft]);
  }
  const accepted: ImportedReservationDraft[] = [];
  const rejections: RowRejection[] = [];
  const reject = (draft: ImportedReservationDraft, code: RowRejectionCode) =>
    rejections.push({
      rowNumber: draft.rowNumber,
      reservationId: draft.reservationId,
      errors: [{ code, field: IMPORT_COLUMNS.reservationId }],
    });
  for (const group of byId.values()) {
    const [first, ...rest] = group;
    if (!first) continue;
    if (rest.some((draft) => draft.rowHash !== first.rowHash)) {
      group.forEach((draft) => reject(draft, 'CONFLICTING_DUPLICATE_IN_FILE'));
      continue;
    }
    accepted.push(first);
    rest.forEach((draft) => reject(draft, 'DUPLICATE_ROW_IN_FILE'));
  }
  return { drafts: accepted, rejections, ignoredColumns: [] };
}

/** Normaliza todas las filas sin detenerse en las inválidas (procesamiento parcial). */
export function normalizeImportRows(table: ImportTable, now: Date): NormalizedImportRows {
  const columns = resolveImportColumns(table.headers);
  if (table.rows.length === 0) throw new InvalidImportFileException('NO_DATA_ROWS');

  const drafts: ImportedReservationDraft[] = [];
  const rejections: RowRejection[] = [];
  for (const row of table.rows) {
    const result = normalizeRow(row, table, columns, now);
    if (result.draft) drafts.push(result.draft);
    if (result.rejection) rejections.push(result.rejection);
  }
  const deduplicated = separateFileDuplicates(drafts);
  return {
    drafts: deduplicated.drafts,
    rejections: [...rejections, ...deduplicated.rejections],
    ignoredColumns: columns.ignoredColumns,
  };
}
