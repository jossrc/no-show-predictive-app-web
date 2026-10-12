import type { BookingEvidence } from '../../src/modules/ReservationRisk/Shared/models/BookingEvidence.js';
import type { BookingEvidenceSource } from '../../src/modules/ReservationRisk/Shared/persistence/BookingEvidenceSource.js';
import type { SnapshotEvidenceSource } from '../../src/shared/data/DataSourceMode.js';

export class FakeBookingEvidenceSource implements BookingEvidenceSource {
  readonly evidence = new Map<string, BookingEvidence>();
  loads = 0;

  constructor(
    readonly servicesTemporalEvidence: BookingEvidenceSource['servicesTemporalEvidence'] = 'NONE_CURRENT_REPLICA',
    readonly snapshotEvidenceSource: SnapshotEvidenceSource = 'VERIFIED_BOOKING_SNAPSHOT',
  ) {}

  add(evidence: BookingEvidence): void {
    this.evidence.set(evidence.reservationId, evidence);
  }

  async load(reservationId: string): Promise<BookingEvidence | null> {
    this.loads += 1;
    return this.evidence.get(reservationId) ?? null;
  }
}
