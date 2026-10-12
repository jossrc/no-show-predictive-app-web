import type { SnapshotEvidenceSource } from '../../../../shared/data/DataSourceMode.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import { InvalidReservationQueryException } from '../errors/InvalidReservationQueryException.js';
import type { Reservation } from '../models/Reservation.js';
import type { ReservationWithScores } from '../models/ReservationScoreSummary.js';
import type { ReservationCursorPosition } from '../pagination/ReservationCursor.js';
import type {
  ReservationListCriteria,
  ReservationListPage,
  ReservationListRow,
  ReservationRepository,
} from './ReservationRepository.js';
import type { RankedScore, ReservationScoreReader } from './ReservationScoreReader.js';
import type { ReservationSource, ReservationSourceFilters } from './ReservationSource.js';

/**
 * Tope de reservas puntuadas por modelo que se ordenan en memoria para un ranking GLOBAL exacto.
 * Los scores solo nacen de POST explícitos, así que el universo es pequeño; por encima del tope
 * se rechaza la consulta (422) en vez de ordenar solo una página.
 */
export const MAX_RANKING_CANDIDATES = 50_000;

interface RankedRow {
  readonly reservation: Reservation;
  readonly probability: number;
}

function compareIds(left: DecimalId, right: DecimalId): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Desempate estable del listado por score: (appointmentAt ASC, reservationId ASC). */
function compareTieBreak(left: Reservation, right: Reservation): number {
  const byTime = left.appointmentAt.getTime() - right.appointmentAt.getTime();
  return byTime !== 0 ? byTime : compareIds(left.reservationId, right.reservationId);
}

function compareRanked(left: RankedRow, right: RankedRow, descending: boolean): number {
  if (left.probability !== right.probability) {
    return descending ? right.probability - left.probability : left.probability - right.probability;
  }
  return compareTieBreak(left.reservation, right.reservation);
}

function isAfterCursor(
  row: RankedRow,
  cursor: ReservationCursorPosition,
  descending: boolean,
): boolean {
  const probability = cursor.probability;
  if (probability === null || probability === undefined) return false;
  const pivot: RankedRow = {
    probability,
    reservation: {
      ...row.reservation,
      appointmentAt: cursor.appointmentAt,
      reservationId: cursor.reservationId,
    },
  };
  return compareRanked(row, pivot, descending) > 0;
}

function filtersOf(criteria: ReservationListCriteria): ReservationSourceFilters {
  return {
    startInclusive: criteria.startInclusive,
    endExclusive: criteria.endExclusive,
    status: criteria.status,
    clinicId: criteria.clinicId,
    clinicScope: criteria.clinicScope,
  };
}

/**
 * ReservationRepository runtime: reservas y filtros de negocio desde la FUENTE (PostgreSQL solo
 * lectura o fixtures sintéticas) y scores desde el almacén predictivo LOCAL. No hay joins entre
 * ambos: el orden por score se resuelve en dos fases (ranking local global → verificación de
 * filtros en la fuente → cola cronológica NULLS LAST), sin N+1 y sin ordenar solo la página.
 */
export class ScoredReservationRepository implements ReservationRepository {
  constructor(
    private readonly source: ReservationSource,
    private readonly scores: ReservationScoreReader,
  ) {}

  async list(criteria: ReservationListCriteria): Promise<ReservationListPage> {
    const storeAvailable = await this.scores.isAvailable();
    const usesScoreFilter =
      criteria.probabilityRange !== null || criteria.experimentalRiskLevel !== null;

    if (criteria.sortField === 'appointmentAt') {
      return this.listChronological(criteria, storeAvailable, usesScoreFilter);
    }
    return this.listByScore(criteria, storeAvailable, usesScoreFilter);
  }

  async findById(reservationId: DecimalId): Promise<Reservation | null> {
    return this.source.findById(reservationId);
  }

  async findWithScores(
    reservationId: DecimalId,
    snapshotEvidence: SnapshotEvidenceSource,
  ): Promise<ReservationWithScores | null> {
    const reservation = await this.source.findById(reservationId);
    if (!reservation) return null;
    const [row] = await this.enrich(
      [reservation],
      snapshotEvidence,
      await this.scores.isAvailable(),
    );
    return row ?? null;
  }

  async clinicExists(clinicId: number): Promise<boolean> {
    return this.source.clinicExists(clinicId);
  }

  private async ranked(
    criteria: ReservationListCriteria,
    storeAvailable: boolean,
  ): Promise<readonly RankedScore[]> {
    if (!storeAvailable) return [];
    const requiresPolicy =
      criteria.sortField === 'experimentalRisk' || criteria.experimentalRiskLevel !== null;
    if (requiresPolicy && criteria.experimentalPolicyHash === null) return [];

    const ranked = await this.scores.rankLatest({
      modelKey: criteria.modelKey,
      evidence: criteria.snapshotEvidence,
      probabilityRange: criteria.probabilityRange,
      experimentalPolicyHash: requiresPolicy ? criteria.experimentalPolicyHash : null,
      experimentalRiskLevel: criteria.experimentalRiskLevel,
    });
    if (ranked.length > MAX_RANKING_CANDIDATES) {
      throw new InvalidReservationQueryException(
        'RANKING_CANDIDATES_EXCEEDED',
        'sort',
        `El ranking por score admite hasta ${MAX_RANKING_CANDIDATES} reservas puntuadas por modelo`,
      );
    }
    return ranked;
  }

  private async listChronological(
    criteria: ReservationListCriteria,
    storeAvailable: boolean,
    usesScoreFilter: boolean,
  ): Promise<ReservationListPage> {
    const onlyIds = usesScoreFilter
      ? (await this.ranked(criteria, storeAvailable)).map((row) => row.reservationId)
      : null;
    if (onlyIds !== null && onlyIds.length === 0) {
      return { rows: [], hasMore: false, predictiveStoreAvailable: storeAvailable };
    }

    const page = await this.source.list({
      ...filtersOf(criteria),
      direction: criteria.sortDirection,
      onlyIds,
      excludeIds: null,
      after: criteria.after
        ? {
            appointmentAt: criteria.after.appointmentAt,
            reservationId: criteria.after.reservationId,
          }
        : null,
      limit: criteria.limit,
    });
    const rows = await this.enrich(page.rows, criteria.snapshotEvidence, storeAvailable);
    return {
      rows: rows.map((row) => ({
        ...row,
        sortProbability:
          row.scores.find((score) => score.modelKey === criteria.modelKey)?.probabilityNoShow ??
          null,
      })),
      hasMore: page.hasMore,
      predictiveStoreAvailable: storeAvailable,
    };
  }

  private async listByScore(
    criteria: ReservationListCriteria,
    storeAvailable: boolean,
    usesScoreFilter: boolean,
  ): Promise<ReservationListPage> {
    const descending = criteria.sortDirection === 'desc';
    const ranked = await this.ranked(criteria, storeAvailable);
    const probabilityById = new Map(ranked.map((row) => [row.reservationId, row.probability]));

    // Fase 2: la FUENTE decide qué candidatos cumplen período/estado/sede/alcance hoy.
    const eligible =
      ranked.length === 0
        ? []
        : (
            await this.source.list({
              ...filtersOf(criteria),
              direction: 'asc',
              onlyIds: ranked.map((row) => row.reservationId),
              excludeIds: null,
              after: null,
              limit: ranked.length,
            })
          ).rows;

    const scored: RankedRow[] = eligible
      .map((reservation) => ({
        reservation,
        probability: probabilityById.get(reservation.reservationId) as number,
      }))
      .sort((left, right) => compareRanked(left, right, descending));

    const after = criteria.after;
    const inTail =
      after !== null && (after.probability === null || after.probability === undefined);
    const found = inTail
      ? scored.length
      : after
        ? scored.findIndex((row) => isAfterCursor(row, after, descending))
        : 0;
    const from = found === -1 ? scored.length : found;
    const window = scored.slice(from, from + criteria.limit + 1);

    const selected: Array<{ reservation: Reservation; sortProbability: number | null }> = window
      .slice(0, criteria.limit)
      .map((row) => ({ reservation: row.reservation, sortProbability: row.probability }));
    let hasMore = window.length > criteria.limit;

    // Fase 3: cola NULLS LAST (sin score del modelo / sin banda en la política), cronológica.
    if (!hasMore && !usesScoreFilter) {
      const tail = await this.source.list({
        ...filtersOf(criteria),
        direction: 'asc',
        onlyIds: null,
        excludeIds: scored.length > 0 ? scored.map((row) => row.reservation.reservationId) : null,
        after:
          inTail && after
            ? { appointmentAt: after.appointmentAt, reservationId: after.reservationId }
            : null,
        limit: criteria.limit - selected.length,
      });
      selected.push(...tail.rows.map((reservation) => ({ reservation, sortProbability: null })));
      hasMore = tail.hasMore;
    }

    const enriched = await this.enrich(
      selected.map((row) => row.reservation),
      criteria.snapshotEvidence,
      storeAvailable,
    );
    return {
      rows: enriched.map((row, index) => ({
        ...row,
        sortProbability: selected[index]?.sortProbability ?? null,
      })),
      hasMore,
      predictiveStoreAvailable: storeAvailable,
    };
  }

  private async enrich(
    reservations: readonly Reservation[],
    evidence: SnapshotEvidenceSource,
    storeAvailable: boolean,
  ): Promise<ReservationListRow[]> {
    const ids = reservations.map((reservation) => reservation.reservationId);
    const read = storeAvailable && ids.length > 0;
    const [latest, withSnapshot] = await Promise.all([
      read ? this.scores.latestScores(ids, evidence) : new Map<DecimalId, never[]>(),
      read ? this.scores.reservationsWithUsableSnapshot(ids, evidence) : new Set<DecimalId>(),
    ]);

    return reservations.map((reservation) => ({
      reservation,
      scores: latest.get(reservation.reservationId) ?? [],
      hasUsableSnapshot: withSnapshot.has(reservation.reservationId),
      sortProbability: null,
    }));
  }
}
