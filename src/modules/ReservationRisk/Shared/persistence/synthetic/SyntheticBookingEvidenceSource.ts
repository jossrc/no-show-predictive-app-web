import {
  SYNTHETIC_DEMO_RESERVATIONS,
  type SyntheticReservationFixture,
} from '../../../../../shared/data/synthetic/SyntheticDemoDataset.js';
import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { BookingEvidence } from '../../models/BookingEvidence.js';
import type { BookingEvidenceSource } from '../BookingEvidenceSource.js';

const SYNTHETIC_CLIENT_STAMP = new Date('2026-01-01T00:00:00.000Z');

function toEvidence(fixture: SyntheticReservationFixture): BookingEvidence {
  return {
    reservationId: fixture.reservationId,
    clientId: fixture.clientId,
    clinicId: fixture.clinicId,
    reservationStatus: fixture.status,
    bookingCreatedAt: fixture.bookingCreatedAt === null ? null : new Date(fixture.bookingCreatedAt),
    appointmentAt: new Date(fixture.appointmentAt),
    appointmentEndAt: new Date(fixture.appointmentEndAt),
    fwaFlag: fixture.fwaFlag,
    hasRescheduleEvent: fixture.hasRescheduleEvent,
    client: { ...fixture.client, lastModifiedAt: SYNTHETIC_CLIENT_STAMP },
    services: [
      {
        sourceDetailId: `900000000301${fixture.reservationId.slice(-3)}`,
        productId: '900101',
        productType: 1,
        bodyAreaProductId: '101',
        isMedicalEvaluation: false,
        productFound: true,
        catalogResolved: true,
      },
    ],
    // Captura sintética "en el instante de reserva": solo existe en este dataset de demostración.
    servicesTemporalEvidence: 'CAPTURED_AT_BOOKING',
    sourceIngestionBatchId: null,
    evidenceSource: 'SYNTHETIC_DEMO_ONLY',
  };
}

/**
 * Evidencia SYNTHETIC_DEMO_ONLY: produce snapshots marcados como sintéticos, que el modo real
 * nunca acepta (BookingSnapshotResolver exige la evidencia del modo activo).
 */
export class SyntheticBookingEvidenceSource implements BookingEvidenceSource {
  readonly servicesTemporalEvidence = 'CAPTURED_AT_BOOKING' as const;
  readonly snapshotEvidenceSource = 'SYNTHETIC_DEMO_ONLY' as const;

  constructor(
    private readonly fixtures: readonly SyntheticReservationFixture[] = SYNTHETIC_DEMO_RESERVATIONS,
  ) {}

  async load(reservationId: DecimalId): Promise<BookingEvidence | null> {
    const fixture = this.fixtures.find((candidate) => candidate.reservationId === reservationId);
    return fixture ? toEvidence(fixture) : null;
  }
}
