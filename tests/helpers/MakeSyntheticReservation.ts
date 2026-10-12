/**
 * Fábricas de datos ESTRICTAMENTE SINTÉTICOS (IDs en el rango 9xxxxxxxxxxxxx, fechas
 * artificiales). Nunca representan clientes reales.
 */
import type { ClientHistoryAsOfSummary } from '../../src/modules/ClientHistory/Shared/models/ClientHistoryAsOfSummary.js';
import { RiskFeaturesBuilder } from '../../src/modules/ReservationRisk/Shared/calculation/RiskFeaturesBuilder.js';
import { computeSnapshotHash } from '../../src/modules/ReservationRisk/Shared/calculation/SnapshotHash.js';
import type { BookingEvidence } from '../../src/modules/ReservationRisk/Shared/models/BookingEvidence.js';
import type { BookingFeatureSnapshot } from '../../src/modules/ReservationRisk/Shared/models/BookingFeatureSnapshot.js';
import type { VerifiedBookingSnapshot } from '../../src/modules/ReservationRisk/Shared/models/VerifiedBookingSnapshot.js';
import type { Reservation } from '../../src/modules/Reservations/Shared/models/Reservation.js';
import type { SnapshotEvidenceSource } from '../../src/shared/data/DataSourceMode.js';

export const SYNTHETIC_RESERVATION_ID = '900000000001001';
export const SYNTHETIC_CLIENT_ID = '900000000002001';
/** Mayor que Number.MAX_SAFE_INTEGER: debe viajar como string sin redondeo. */
export const UNSAFE_BIGINT_ID = '9007199254740993';

export function makeReservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    reservationId: SYNTHETIC_RESERVATION_ID,
    clientId: SYNTHETIC_CLIENT_ID,
    clinicId: 1,
    appointmentAt: new Date('2026-11-12T20:00:00.000Z'),
    bookingCreatedAt: new Date('2026-10-20T16:00:00.000Z'),
    status: 'SCHEDULED',
    sourceClassification: 'FUTURE_PENDING',
    hasRescheduleEvent: false,
    classificationCutoffAt: new Date('2026-10-21T00:00:00.000Z'),
    ...overrides,
  };
}

export function makeVerifiedSnapshot(
  overrides: Partial<VerifiedBookingSnapshot> = {},
): VerifiedBookingSnapshot {
  return {
    reservationId: SYNTHETIC_RESERVATION_ID,
    clientId: SYNTHETIC_CLIENT_ID,
    clinicId: 1,
    predictionAt: new Date('2026-10-20T16:00:00.000Z'),
    appointmentAt: new Date('2026-11-12T20:00:00.000Z'),
    appointmentEndAt: new Date('2026-11-12T20:40:00.000Z'),
    fwaFlag: 0,
    clientBirthDate: '1998-03-15',
    clientSex: 'F',
    scheduledServices: [
      {
        sourceDetailId: '900000000003001',
        productId: '900101',
        productType: 1,
        bodyAreaProductId: '101',
        isMedicalEvaluation: false,
      },
    ],
    evidenceSource: 'VERIFIED_BOOKING_SNAPSHOT',
    ...overrides,
  };
}

export function makeHistory(
  overrides: Partial<ClientHistoryAsOfSummary> = {},
): ClientHistoryAsOfSummary {
  return {
    clientId: SYNTHETIC_CLIENT_ID,
    cutoffAt: new Date('2026-10-20T16:00:00.000Z'),
    previousAttended: 0,
    previousNoShow: 0,
    lastAttendedAt: null,
    lastNoShowAt: null,
    latestKnownAt: null,
    ...overrides,
  };
}

export function makeBookingEvidence(overrides: Partial<BookingEvidence> = {}): BookingEvidence {
  const predictionAt = new Date('2026-10-20T16:00:00.000Z');
  return {
    reservationId: SYNTHETIC_RESERVATION_ID,
    clientId: SYNTHETIC_CLIENT_ID,
    clinicId: 1,
    reservationStatus: 'SCHEDULED',
    bookingCreatedAt: predictionAt,
    appointmentAt: new Date('2026-11-12T20:00:00.000Z'),
    appointmentEndAt: new Date('2026-11-12T20:40:00.000Z'),
    fwaFlag: 0,
    hasRescheduleEvent: false,
    client: { birthDate: '1998-03-15', sex: 'F', lastModifiedAt: new Date('2026-01-01T00:00:00Z') },
    services: [
      {
        sourceDetailId: '900000000003001',
        productId: '900101',
        productType: 1,
        bodyAreaProductId: '101',
        isMedicalEvaluation: false,
        productFound: true,
        catalogResolved: true,
      },
    ],
    servicesTemporalEvidence: 'CAPTURED_AT_BOOKING',
    sourceIngestionBatchId: null,
    evidenceSource: 'VERIFIED_BOOKING_SNAPSHOT',
    ...overrides,
  };
}

/** Snapshot persistible construido con el builder real (hash e integridad válidos). */
export function makeStoredSnapshot(
  params: {
    snapshotId?: string;
    verified?: VerifiedBookingSnapshot;
    history?: ClientHistoryAsOfSummary;
    evidenceSource?: SnapshotEvidenceSource;
    createdAt?: Date;
  } = {},
): BookingFeatureSnapshot {
  const verified = params.verified ?? makeVerifiedSnapshot();
  const history =
    params.history ?? makeHistory({ clientId: verified.clientId, cutoffAt: verified.predictionAt });
  const built = new RiskFeaturesBuilder().build(verified, history);
  if (built.kind !== 'BUILT') throw new Error('Fixture sintética no evaluable');

  const snapshotHash = computeSnapshotHash({
    reservationId: verified.reservationId,
    predictionAt: verified.predictionAt,
    featureVersion: built.value.featureVersion,
    builderVersion: built.value.featureContext.builder_version,
    features: built.value.features,
  });

  return {
    snapshotId: params.snapshotId ?? '1',
    reservationId: verified.reservationId,
    clientId: verified.clientId,
    snapshotType: 'booking_creation',
    predictionAt: verified.predictionAt,
    appointmentAt: verified.appointmentAt,
    featureVersion: built.value.featureVersion,
    builderVersion: built.value.featureContext.builder_version,
    snapshotHash,
    features: built.value.features,
    evidenceSource: params.evidenceSource ?? verified.evidenceSource,
    createdAt: params.createdAt ?? new Date('2026-10-20T16:00:01.000Z'),
  };
}
