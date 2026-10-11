import type { SnapshotEvidenceSource } from '../../src/shared/data/DataSourceMode.js';
import type { Reservation } from '../../src/modules/Reservations/Shared/models/Reservation.js';
import type { ReservationWithScores } from '../../src/modules/Reservations/Shared/models/ReservationScoreSummary.js';
import type {
  ReservationListCriteria,
  ReservationListPage,
  ReservationListRow,
  ReservationRepository,
} from '../../src/modules/Reservations/Shared/persistence/ReservationRepository.js';
import type { InMemoryPredictiveStore } from './InMemoryPredictiveStore.js';

/**
 * Especificación ejecutable de la semántica del listado SQL (filtros, NULLS LAST, desempates,
 * keyset). Las pruebas de integración verifican la misma semántica contra PostgreSQL.
 */
export class InMemoryReservationRepository implements ReservationRepository {
  readonly reservations = new Map<string, Reservation>();
  readonly clinics = new Set<number>([1, 2]);
  listCalls = 0;
  failWith: Error | null = null;

  constructor(private readonly store: InMemoryPredictiveStore) {}

  add(...reservations: Reservation[]): void {
    for (const reservation of reservations)
      this.reservations.set(reservation.reservationId, reservation);
  }

  async list(criteria: ReservationListCriteria): Promise<ReservationListPage> {
    this.listCalls += 1;
    if (this.failWith) throw this.failWith;

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
      .map((r) => this.toRow(r, criteria.snapshotEvidence, criteria.modelKey))
      .filter((row) => {
        const band = criteria.probabilityRange;
        if (!band) return true;
        const p = row.sortProbability;
        return p !== null && p >= band.minInclusive && p < band.maxExclusive;
      })
      .sort((a, b) => compareRows(a, b, criteria))
      .filter((row) => isAfterCursor(row, criteria));

    return {
      rows: rows.slice(0, criteria.limit),
      hasMore: rows.length > criteria.limit,
      predictiveStoreAvailable: true,
    };
  }

  async findById(reservationId: string): Promise<Reservation | null> {
    if (this.failWith) throw this.failWith;
    return this.reservations.get(reservationId) ?? null;
  }

  async findWithScores(
    reservationId: string,
    evidence: SnapshotEvidenceSource,
  ): Promise<ReservationWithScores | null> {
    const reservation = await this.findById(reservationId);
    return reservation ? this.toRow(reservation, evidence, 'random_forest_full_v1') : null;
  }

  async clinicExists(clinicId: number): Promise<boolean> {
    return this.clinics.has(clinicId);
  }

  private toRow(
    reservation: Reservation,
    evidence: SnapshotEvidenceSource,
    modelKey: string,
  ): ReservationListRow {
    const scores = this.store.latestScoresForReservation(reservation.reservationId, evidence);
    return {
      reservation,
      scores: scores.map((s) => ({
        modelKey: s.modelKey,
        modelVersion: s.modelVersion,
        modelHash: s.modelHash,
        probabilityNoShow: s.probabilityNoShow,
        scoredAt: s.scoredAt,
        predictionRunId: s.predictionRunId,
      })),
      hasUsableSnapshot: this.store.hasSnapshot(reservation.reservationId, evidence),
      sortProbability: scores.find((s) => s.modelKey === modelKey)?.probabilityNoShow ?? null,
    };
  }
}

function compareTieBreak(
  a: ReservationListRow,
  b: ReservationListRow,
  descending: boolean,
): number {
  const byTime = a.reservation.appointmentAt.getTime() - b.reservation.appointmentAt.getTime();
  const result =
    byTime !== 0
      ? byTime
      : BigInt(a.reservation.reservationId) < BigInt(b.reservation.reservationId)
        ? -1
        : BigInt(a.reservation.reservationId) > BigInt(b.reservation.reservationId)
          ? 1
          : 0;
  return descending ? -result : result;
}

function compareRows(
  a: ReservationListRow,
  b: ReservationListRow,
  c: ReservationListCriteria,
): number {
  const descending = c.sortDirection === 'desc';
  if (c.sortField === 'appointmentAt') return compareTieBreak(a, b, descending);

  const pa = a.sortProbability;
  const pb = b.sortProbability;
  if (pa === null && pb === null) return compareTieBreak(a, b, false);
  if (pa === null) return 1;
  if (pb === null) return -1;
  if (pa !== pb) return descending ? pb - pa : pa - pb;
  return compareTieBreak(a, b, false);
}

function isAfterCursor(row: ReservationListRow, c: ReservationListCriteria): boolean {
  const after = c.after;
  if (!after) return true;
  const cursorRow: ReservationListRow = {
    reservation: {
      ...row.reservation,
      appointmentAt: after.appointmentAt,
      reservationId: after.reservationId,
    },
    scores: [],
    hasUsableSnapshot: false,
    sortProbability: after.probability ?? null,
  };
  return compareRows(row, cursorRow, c) > 0;
}
