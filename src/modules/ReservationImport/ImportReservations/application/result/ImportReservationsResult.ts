import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { ImportBatch, RowRejection } from '../../../Shared/models/ImportedReservation.js';

export interface ImportReservationsResult {
  readonly batch: ImportBatch;
  /** Solo filas efectivamente persistidas por este lote. */
  readonly accepted: ReadonlyArray<{
    readonly rowNumber: number;
    readonly reservationId: DecimalId;
  }>;
  readonly rejections: readonly RowRejection[];
  readonly ignoredColumns: readonly string[];
}
