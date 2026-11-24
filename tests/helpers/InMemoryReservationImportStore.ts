import type {
  ImportBatch,
  ImportedReservation,
  RowRejection,
} from '../../src/modules/ReservationImport/Shared/models/ImportedReservation.js';
import type {
  ImportBatchDraft,
  ImportedReservationRepository,
  SavedImportBatch,
} from '../../src/modules/ReservationImport/Shared/persistence/ImportedReservationRepository.js';
import { toSourceReservation } from '../../src/modules/ReservationImport/Shared/persistence/postgres/ImportedReservationRows.js';
import type { Reservation } from '../../src/modules/Reservations/Shared/models/Reservation.js';
import type {
  ReservationSource,
  ReservationSourceCriteria,
  ReservationSourcePage,
} from '../../src/modules/Reservations/Shared/persistence/ReservationSource.js';
import { InMemoryReservationSource } from './InMemoryReservationRepository.js';

/**
 * Doble en memoria de ml.app_imported_reservations + lotes + rechazos con la semántica de
 * PostgreSQL: UNIQUE(reservation_id) con ON CONFLICT DO NOTHING y transacción todo-o-nada.
 * Como ReservationSource reutiliza la especificación ejecutable de la fuente en memoria.
 */
export class InMemoryReservationImportStore
  implements ImportedReservationRepository, ReservationSource
{
  readonly rows = new Map<string, ImportedReservation>();
  readonly batches: ImportBatch[] = [];
  readonly rejections: Array<{ batchId: string; rejection: RowRejection }> = [];
  /** Simula una importación concurrente que inserta estas reservas justo antes del INSERT. */
  racingInserts: ImportedReservation[] = [];
  private readonly view = new InMemoryReservationSource();

  async existingRowHashes(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    return new Map(
      ids.flatMap((id) => {
        const row = this.rows.get(id);
        return row ? [[id, row.rowHash] as const] : [];
      }),
    );
  }

  async saveBatch(draft: ImportBatchDraft): Promise<SavedImportBatch> {
    for (const racing of this.racingInserts) this.rows.set(racing.reservationId, racing);
    this.racingInserts = [];

    const inserted = draft.candidates.filter(
      (candidate) => !this.rows.has(candidate.reservationId),
    );
    const concurrent = new Map(
      draft.candidates
        .filter((candidate) => this.rows.has(candidate.reservationId))
        .map((candidate) => [
          candidate.reservationId,
          this.rows.get(candidate.reservationId)!.rowHash,
        ]),
    );
    const { batch, rejections } = draft.finalize(concurrent);
    if (batch.acceptedRows !== inserted.length) throw new Error('conteo inconsistente');

    for (const candidate of inserted) {
      const record: ImportedReservation = {
        ...candidate,
        batchId: draft.batchId,
        classificationCutoffAt: draft.processedAt,
      };
      this.rows.set(candidate.reservationId, record);
      this.view.reservations.set(candidate.reservationId, toSourceReservation(record));
    }
    this.batches.push(batch);
    this.rejections.push(...rejections.map((rejection) => ({ batchId: batch.batchId, rejection })));
    return { batch, rejections, accepted: inserted };
  }

  async findByReservationId(reservationId: string): Promise<ImportedReservation | null> {
    return this.rows.get(reservationId) ?? null;
  }

  // --- ReservationSource (mismos filtros y keyset que la fuente principal) ---
  async list(criteria: ReservationSourceCriteria): Promise<ReservationSourcePage> {
    return this.view.list(criteria);
  }

  async findById(reservationId: string): Promise<Reservation | null> {
    return this.view.findById(reservationId);
  }

  async clinicExists(clinicId: number): Promise<boolean> {
    return [...this.rows.values()].some((row) => row.clinicId === clinicId);
  }
}
