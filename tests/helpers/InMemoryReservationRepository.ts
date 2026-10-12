import type { Reservation } from '../../src/modules/Reservations/Shared/models/Reservation.js';
import type { ReservationWithScores } from '../../src/modules/Reservations/Shared/models/ReservationScoreSummary.js';
import type {
  ReservationListCriteria,
  ReservationListPage,
  ReservationRepository,
} from '../../src/modules/Reservations/Shared/persistence/ReservationRepository.js';
import type {
  ReservationSource,
  ReservationSourceCriteria,
  ReservationSourcePage,
} from '../../src/modules/Reservations/Shared/persistence/ReservationSource.js';
import { ScoredReservationRepository } from '../../src/modules/Reservations/Shared/persistence/ScoredReservationRepository.js';
import type { SnapshotEvidenceSource } from '../../src/shared/data/DataSourceMode.js';
import type { InMemoryPredictiveStore } from './InMemoryPredictiveStore.js';

function compareChronological(left: Reservation, right: Reservation): number {
  const byTime = left.appointmentAt.getTime() - right.appointmentAt.getTime();
  if (byTime !== 0) return byTime;
  const a = BigInt(left.reservationId);
  const b = BigInt(right.reservationId);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Fuente en memoria con la semántica del SQL de la réplica (filtros, alcance, keyset
 * cronológico). Especificación ejecutable que la integración contrasta con PostgreSQL.
 */
export class InMemoryReservationSource implements ReservationSource {
  readonly reservations = new Map<string, Reservation>();
  readonly clinics = new Set<number>([1, 2]);
  listCalls = 0;

  async list(criteria: ReservationSourceCriteria): Promise<ReservationSourcePage> {
    this.listCalls += 1;
    const only = criteria.onlyIds ? new Set(criteria.onlyIds) : null;
    const excluded = new Set(criteria.excludeIds ?? []);
    const descending = criteria.direction === 'desc';
    const rows = [...this.reservations.values()]
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
      .sort((a, b) => (descending ? -1 : 1) * compareChronological(a, b))
      .filter((r) => {
        if (!criteria.after) return true;
        const order = compareChronological(r, { ...r, ...criteria.after });
        return descending ? order < 0 : order > 0;
      });
    return { rows: rows.slice(0, criteria.limit), hasMore: rows.length > criteria.limit };
  }

  async findById(reservationId: string): Promise<Reservation | null> {
    return this.reservations.get(reservationId) ?? null;
  }

  async clinicExists(clinicId: number): Promise<boolean> {
    return this.clinics.has(clinicId);
  }
}

/**
 * Repositorio de pruebas: el MISMO ScoredReservationRepository del runtime sobre una fuente en
 * memoria y el almacén predictivo en memoria. `listCalls` cuenta los listados de negocio.
 */
export class InMemoryReservationRepository implements ReservationRepository {
  readonly source = new InMemoryReservationSource();
  readonly reservations = this.source.reservations;
  readonly clinics = this.source.clinics;
  listCalls = 0;
  failWith: Error | null = null;
  private readonly scored: ScoredReservationRepository;

  constructor(store: InMemoryPredictiveStore) {
    this.scored = new ScoredReservationRepository(this.source, store);
  }

  add(...reservations: Reservation[]): void {
    for (const reservation of reservations)
      this.reservations.set(reservation.reservationId, reservation);
  }

  async list(criteria: ReservationListCriteria): Promise<ReservationListPage> {
    this.listCalls += 1;
    if (this.failWith) throw this.failWith;
    return this.scored.list(criteria);
  }

  async findById(reservationId: string): Promise<Reservation | null> {
    if (this.failWith) throw this.failWith;
    return this.scored.findById(reservationId);
  }

  async findWithScores(
    reservationId: string,
    evidence: SnapshotEvidenceSource,
  ): Promise<ReservationWithScores | null> {
    if (this.failWith) throw this.failWith;
    return this.scored.findWithScores(reservationId, evidence);
  }

  async clinicExists(clinicId: number): Promise<boolean> {
    return this.scored.clinicExists(clinicId);
  }
}
