import {
  SYNTHETIC_DEMO_CLASSIFICATION_CUTOFF,
  SYNTHETIC_DEMO_CLINICS,
  SYNTHETIC_DEMO_RESERVATIONS,
  type SyntheticReservationFixture,
} from '../../../../../shared/data/synthetic/SyntheticDemoDataset.js';
import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { Reservation } from '../../models/Reservation.js';
import type {
  ReservationSource,
  ReservationSourceCriteria,
  ReservationSourcePage,
} from '../ReservationSource.js';

function toReservation(fixture: SyntheticReservationFixture): Reservation {
  return {
    reservationId: fixture.reservationId,
    clientId: fixture.clientId,
    clinicId: fixture.clinicId,
    appointmentAt: new Date(fixture.appointmentAt),
    bookingCreatedAt: fixture.bookingCreatedAt === null ? null : new Date(fixture.bookingCreatedAt),
    status: fixture.status,
    sourceClassification: fixture.sourceClassification,
    hasRescheduleEvent: fixture.hasRescheduleEvent,
    classificationCutoffAt: new Date(SYNTHETIC_DEMO_CLASSIFICATION_CUTOFF),
  };
}

function compareChronological(left: Reservation, right: Reservation): number {
  const byTime = left.appointmentAt.getTime() - right.appointmentAt.getTime();
  if (byTime !== 0) return byTime;
  const a = BigInt(left.reservationId);
  const b = BigInt(right.reservationId);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Fuente de reservas SYNTHETIC_DEMO_ONLY desde el dataset versionado (sin PostgreSQL). Misma
 * semántica que el SQL de la réplica: filtros, alcance de sede, keyset y orden cronológico.
 */
export class SyntheticReservationSource implements ReservationSource {
  private readonly reservations: readonly Reservation[];

  constructor(fixtures: readonly SyntheticReservationFixture[] = SYNTHETIC_DEMO_RESERVATIONS) {
    this.reservations = fixtures.map(toReservation);
  }

  async list(criteria: ReservationSourceCriteria): Promise<ReservationSourcePage> {
    const only = criteria.onlyIds ? new Set(criteria.onlyIds) : null;
    const excluded = new Set(criteria.excludeIds ?? []);
    const descending = criteria.direction === 'desc';

    const rows = this.reservations
      .filter((r) => r.status === criteria.status)
      .filter(
        (r) =>
          r.appointmentAt >= criteria.startInclusive && r.appointmentAt < criteria.endExclusive,
      )
      .filter((r) => criteria.clinicId === null || r.clinicId === criteria.clinicId)
      .filter(
        (r) =>
          criteria.clinicScope.kind === 'ALL_CLINICS' ||
          criteria.clinicScope.clinicIds.includes(r.clinicId),
      )
      .filter((r) => (only ? only.has(r.reservationId) : true) && !excluded.has(r.reservationId))
      .sort((left, right) => (descending ? -1 : 1) * compareChronological(left, right))
      .filter((r) => {
        if (!criteria.after) return true;
        const pivot = { ...r, ...criteria.after };
        const order = compareChronological(r, pivot);
        return descending ? order < 0 : order > 0;
      });

    return { rows: rows.slice(0, criteria.limit), hasMore: rows.length > criteria.limit };
  }

  async findById(reservationId: DecimalId): Promise<Reservation | null> {
    return this.reservations.find((r) => r.reservationId === reservationId) ?? null;
  }

  async clinicExists(clinicId: number): Promise<boolean> {
    return SYNTHETIC_DEMO_CLINICS.includes(clinicId);
  }
}
