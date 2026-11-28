import {
  toAppStoreException,
  type AppStoreDatabase,
} from '../../../../../infrastructure/database/postgres/PredictiveAppDatabase.js';
import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { ImportedReservation, RowRejection } from '../../models/ImportedReservation.js';
import type {
  ImportBatchDraft,
  ImportedReservationRepository,
  SavedImportBatch,
} from '../ImportedReservationRepository.js';
import { IMPORTED_COLUMNS, mapImportedRow, type ImportedRow } from './ImportedReservationRows.js';

const INSERT_RESERVATIONS_SQL = `
INSERT INTO ml.app_imported_reservations (
  reservation_id, batch_uid, row_number, client_id, clinic_id, appointment_at, appointment_end_at,
  booking_created_at, reservation_status, fwa_flag, reschedule_count, service_product_ids,
  row_hash, classification_cutoff_at
)
SELECT r.reservation_id, $1::uuid, r.row_number, r.client_id, r.clinic_id, r.appointment_at,
       r.appointment_end_at, r.booking_created_at, r.reservation_status, r.fwa_flag,
       r.reschedule_count, r.service_product_ids::bigint[], r.row_hash, $2::timestamptz
FROM jsonb_to_recordset($3::jsonb) AS r(
  reservation_id bigint, row_number integer, client_id bigint, clinic_id integer,
  appointment_at timestamptz, appointment_end_at timestamptz, booking_created_at timestamptz,
  reservation_status text, fwa_flag smallint, reschedule_count integer,
  service_product_ids text, row_hash text
)
ORDER BY r.row_number
ON CONFLICT (reservation_id) DO NOTHING
RETURNING reservation_id::text AS reservation_id`;

const INSERT_BATCH_SQL = `
INSERT INTO ml.app_reservation_import_batches (
  batch_uid, contract_version, file_format, file_sha256, file_size_bytes, status, processed_at,
  total_rows, accepted_rows, rejected_rows, request_id, actor_kind, actor_user_id
) VALUES ($1::uuid, $2, $3, $4, $5::integer, $6, $7, $8::integer, $9::integer, $10::integer,
          $11, 'INTERNAL_SERVICE', NULL)`;

const INSERT_REJECTIONS_SQL = `
INSERT INTO ml.app_reservation_import_rejections (
  batch_uid, row_number, reservation_id, reason_code, field
)
SELECT $1::uuid, r.row_number, r.reservation_id, r.reason_code, r.field
FROM jsonb_to_recordset($2::jsonb) AS r(
  row_number integer, reservation_id bigint, reason_code text, field text
)`;

/** Una fila por (fila, código, campo): las repeticiones exactas no aportan información. */
function rejectionRows(rejections: readonly RowRejection[]) {
  const rows = new Map<string, object>();
  for (const rejection of rejections) {
    for (const error of rejection.errors) {
      rows.set(`${rejection.rowNumber}|${error.code}|${error.field ?? ''}`, {
        row_number: rejection.rowNumber,
        reservation_id: rejection.reservationId,
        reason_code: error.code,
        field: error.field,
      });
    }
  }
  return [...rows.values()];
}

/**
 * Importación sobre ml.app_* en UNA transacción corta (sin llamadas de red ni lecturas de la
 * fuente): reservas con ON CONFLICT DO NOTHING (idempotencia ante reimportaciones y carreras),
 * luego el lote con sus conteos definitivos y los rechazos (FK diferidas al COMMIT).
 */
export class PostgresImportedReservationRepository implements ImportedReservationRepository {
  constructor(private readonly db: AppStoreDatabase) {}

  async existingRowHashes(ids: readonly DecimalId[]): Promise<ReadonlyMap<DecimalId, string>> {
    if (ids.length === 0) return new Map();
    try {
      const rows = await this.db.query<{ reservation_id: string; row_hash: string }>(
        `SELECT reservation_id::text AS reservation_id, row_hash
         FROM ml.app_imported_reservations WHERE reservation_id = ANY($1::bigint[])`,
        [[...ids]],
      );
      return new Map(rows.map((row) => [row.reservation_id, row.row_hash]));
    } catch (error) {
      throw toAppStoreException('ReadImportedReservationHashes', error);
    }
  }

  async saveBatch(draft: ImportBatchDraft): Promise<SavedImportBatch> {
    try {
      return await this.db.transaction(async (tx) => {
        const payload = draft.candidates.map((candidate) => ({
          reservation_id: candidate.reservationId,
          row_number: candidate.rowNumber,
          client_id: candidate.clientId,
          clinic_id: candidate.clinicId,
          appointment_at: candidate.appointmentAt.toISOString(),
          appointment_end_at: candidate.appointmentEndAt?.toISOString() ?? null,
          booking_created_at: candidate.bookingCreatedAt.toISOString(),
          reservation_status: candidate.status,
          fwa_flag: candidate.fwaFlag,
          reschedule_count: candidate.rescheduleCount,
          service_product_ids: `{${candidate.serviceProductIds.join(',')}}`,
          row_hash: candidate.rowHash,
        }));
        const inserted =
          payload.length === 0
            ? []
            : await tx.query<{ reservation_id: string }>(INSERT_RESERVATIONS_SQL, [
                draft.batchId,
                draft.processedAt,
                JSON.stringify(payload),
              ]);
        const insertedIds = new Set(inserted.map((row) => row.reservation_id));
        const raced = draft.candidates
          .map((candidate) => candidate.reservationId)
          .filter((id) => !insertedIds.has(id));
        const concurrent = new Map(
          raced.length === 0
            ? []
            : (
                await tx.query<{ reservation_id: string; row_hash: string }>(
                  `SELECT reservation_id::text AS reservation_id, row_hash
                   FROM ml.app_imported_reservations WHERE reservation_id = ANY($1::bigint[])`,
                  [raced],
                )
              ).map((row) => [row.reservation_id, row.row_hash] as const),
        );

        const { batch, rejections } = draft.finalize(concurrent);
        if (batch.acceptedRows !== insertedIds.size) {
          throw new Error('Conteo de filas aceptadas distinto de las filas insertadas');
        }
        await tx.query(INSERT_BATCH_SQL, [
          batch.batchId,
          batch.contractVersion,
          batch.fileFormat,
          batch.fileSha256,
          batch.fileSizeBytes,
          batch.status,
          batch.processedAt,
          batch.totalRows,
          batch.acceptedRows,
          batch.rejectedRows,
          batch.requestId,
        ]);
        const rows = rejectionRows(rejections);
        if (rows.length > 0) {
          await tx.query(INSERT_REJECTIONS_SQL, [batch.batchId, JSON.stringify(rows)]);
        }
        return {
          batch,
          rejections,
          accepted: draft.candidates.filter((candidate) =>
            insertedIds.has(candidate.reservationId),
          ),
        };
      });
    } catch (error) {
      throw toAppStoreException('SaveReservationImportBatch', error);
    }
  }

  async findByReservationId(reservationId: DecimalId): Promise<ImportedReservation | null> {
    try {
      const [row] = await this.db.query<ImportedRow>(
        `SELECT ${IMPORTED_COLUMNS} FROM ml.app_imported_reservations i
         WHERE i.reservation_id = $1::bigint`,
        [reservationId],
      );
      return row ? mapImportedRow(row) : null;
    } catch (error) {
      throw toAppStoreException('FindImportedReservation', error);
    }
  }
}
