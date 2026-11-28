import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type {
  ImportBatch,
  ImportedReservation,
  ImportedReservationDraft,
  RowRejection,
} from '../models/ImportedReservation.js';

export interface ImportBatchDraft {
  readonly batchId: string;
  readonly processedAt: Date;
  readonly candidates: readonly ImportedReservationDraft[];
  /**
   * Se invoca DENTRO de la transacción con las reservas que otra importación insertó en paralelo
   * (id → hash existente) y devuelve el encabezado y los rechazos definitivos del lote.
   */
  readonly finalize: (concurrent: ReadonlyMap<DecimalId, string>) => {
    readonly batch: ImportBatch;
    readonly rejections: readonly RowRejection[];
  };
}

export interface SavedImportBatch {
  readonly batch: ImportBatch;
  readonly rejections: readonly RowRejection[];
  /** Reservas insertadas por ESTE lote (nunca las de otro lote concurrente). */
  readonly accepted: readonly ImportedReservationDraft[];
}

/** Lotes, reservas incorporadas y rechazos en ml.app_* (solo SELECT/INSERT, inmutables). */
export interface ImportedReservationRepository {
  /** Hash de contenido de las reservas ya incorporadas (lectura por lote). */
  existingRowHashes(ids: readonly DecimalId[]): Promise<ReadonlyMap<DecimalId, string>>;
  /** Reservas + lote + rechazos en UNA transacción; UNIQUE(reservation_id) evita duplicados. */
  saveBatch(draft: ImportBatchDraft): Promise<SavedImportBatch>;
  findByReservationId(reservationId: DecimalId): Promise<ImportedReservation | null>;
}
