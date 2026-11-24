import {
  ROW_REJECTION_MESSAGES,
  type RowRejectionCode,
} from '../contract/ReservationImportContract.js';
import type { ImportBatchStatus, RowRejection } from '../models/ImportedReservation.js';

export const IMPORT_BATCH_STATUS_LABELS: Readonly<Record<ImportBatchStatus, string>> = {
  COMPLETED: 'Procesado: todas las filas fueron incorporadas',
  COMPLETED_WITH_REJECTIONS: 'Procesado con filas rechazadas',
  NO_ROWS_ACCEPTED: 'Procesado sin filas incorporadas',
};

export const IMPORT_PREDICTION_NOTICE =
  'La importación no genera predicciones. Las estimaciones se solicitan explícitamente con POST /api/v1/reservations/{reservationId}/predictions; la elegibilidad predictiva se evalúa con la evidencia disponible (puede resultar NOT_SCORABLE).';

export function toRowErrors(rejection: RowRejection) {
  return rejection.errors.map((error) => ({
    code: error.code,
    field: error.field,
    message: ROW_REJECTION_MESSAGES[error.code],
  }));
}

/** Filas rechazadas por código (una fila con varios motivos cuenta en cada código una vez). */
export function summarizeRejections(rejections: readonly RowRejection[]) {
  const rows = new Map<RowRejectionCode, number>();
  for (const rejection of rejections) {
    for (const code of new Set(rejection.errors.map((error) => error.code))) {
      rows.set(code, (rows.get(code) ?? 0) + 1);
    }
  }
  return [...rows.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, count]) => ({ code, message: ROW_REJECTION_MESSAGES[code], rows: count }));
}
