import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { ImportColumnName, RowRejectionCode } from '../contract/ReservationImportContract.js';
import type { ImportFileFormat } from '../parsing/ImportTable.js';

export type ImportedReservationStatus = 'SCHEDULED' | 'CANCELLED';

/** Fila válida normalizada a los tipos del dominio (instantes en UTC). */
export interface ImportedReservationDraft {
  readonly rowNumber: number;
  readonly reservationId: DecimalId;
  readonly clientId: DecimalId;
  readonly clinicId: number;
  readonly appointmentAt: Date;
  readonly appointmentEndAt: Date | null;
  readonly bookingCreatedAt: Date;
  readonly status: ImportedReservationStatus;
  readonly fwaFlag: 0 | -1 | null;
  readonly rescheduleCount: number;
  /** DiaryZoneID por línea de servicio prevista, en el orden del archivo (con multiplicidad). */
  readonly serviceProductIds: readonly DecimalId[];
  /** SHA-256 del contenido normalizado: identifica reimportaciones idénticas. */
  readonly rowHash: string;
}

/** Reserva incorporada y persistida en ml.app_imported_reservations. */
export interface ImportedReservation extends Omit<ImportedReservationDraft, 'rowNumber'> {
  readonly batchId: string;
  readonly rowNumber: number;
  /** Momento de procesamiento del lote: la clasificación «programada» es relativa a ese corte. */
  readonly classificationCutoffAt: Date;
}

export interface RowRejectionError {
  readonly code: RowRejectionCode;
  readonly field: ImportColumnName | null;
}

export interface RowRejection {
  readonly rowNumber: number;
  /** Solo si el identificador es válido; nunca se devuelve otro valor de la fila. */
  readonly reservationId: DecimalId | null;
  readonly errors: readonly RowRejectionError[];
}

export type ImportBatchStatus = 'COMPLETED' | 'COMPLETED_WITH_REJECTIONS' | 'NO_ROWS_ACCEPTED';

export interface ImportBatch {
  readonly batchId: string;
  readonly contractVersion: string;
  readonly fileFormat: ImportFileFormat;
  readonly fileSha256: string;
  readonly fileSizeBytes: number;
  readonly status: ImportBatchStatus;
  readonly processedAt: Date;
  readonly totalRows: number;
  readonly acceptedRows: number;
  readonly rejectedRows: number;
  readonly requestId: string;
  readonly actorKind: 'INTERNAL_SERVICE';
  readonly actorUserId: null;
}
