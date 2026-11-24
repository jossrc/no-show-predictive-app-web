import type {
  NewRetentionContact,
  RetentionContact,
  RetentionContactSummary,
} from '../../src/modules/CustomerRetention/Shared/models/RetentionContact.js';
import type {
  RetentionContactInsertOutcome,
  RetentionContactRepository,
} from '../../src/modules/CustomerRetention/Shared/persistence/RetentionContactRepository.js';

/**
 * Doble con la semántica de UNIQUE(reservation_id) + ON CONFLICT DO NOTHING: el primer INSERT
 * gana y los siguientes reciben el registro existente (created=false). `inserts` cuenta solo
 * inserciones efectivas.
 */
export class InMemoryRetentionContactRepository implements RetentionContactRepository {
  readonly rows = new Map<string, RetentionContact>();
  inserts = 0;
  batchReads = 0;
  private sequence = 0;

  async findByReservation(reservationId: string): Promise<RetentionContact | null> {
    return this.rows.get(reservationId) ?? null;
  }

  async insertIfAbsent(contact: NewRetentionContact): Promise<RetentionContactInsertOutcome> {
    const existing = this.rows.get(contact.reservationId);
    if (existing) return { record: existing, created: false };
    this.sequence += 1;
    this.inserts += 1;
    const record: RetentionContact = { ...contact, contactId: String(this.sequence) };
    this.rows.set(contact.reservationId, record);
    return { record, created: true };
  }

  async contactsFor(
    reservationIds: readonly string[],
  ): Promise<ReadonlyMap<string, RetentionContactSummary>> {
    this.batchReads += 1;
    return new Map(
      reservationIds.flatMap((id) => {
        const row = this.rows.get(id);
        return row
          ? [
              [
                id,
                {
                  contactId: row.contactId,
                  contactedAt: row.contactedAt,
                  modelKey: row.modelKey,
                  predictionRunId: row.predictionRunId,
                },
              ] as const,
            ]
          : [];
      }),
    );
  }
}
