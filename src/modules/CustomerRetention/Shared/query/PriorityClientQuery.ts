import type { MlModelKey } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import {
  allowedSnapshotEvidence,
  type DataSourceMode,
} from '../../../../shared/data/DataSourceMode.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { ClinicAccessScope } from '../../../../shared/security/RequestPrincipal.js';
import { InvalidReservationQueryException } from '../../../Reservations/Shared/errors/InvalidReservationQueryException.js';
import type { Reservation } from '../../../Reservations/Shared/models/Reservation.js';
import type {
  ExperimentalRiskSummary,
  ReservationScoreSummary,
} from '../../../Reservations/Shared/models/ReservationScoreSummary.js';
import type { ReservationCursorPosition } from '../../../Reservations/Shared/pagination/ReservationCursor.js';
import type { ReservationRepository } from '../../../Reservations/Shared/persistence/ReservationRepository.js';
import type {
  ExperimentalPolicyIdentity,
  ReservationScoreReader,
} from '../../../Reservations/Shared/persistence/ReservationScoreReader.js';
import type { RetentionContactSummary } from '../models/RetentionContact.js';
import type { RetentionContactRepository } from '../persistence/RetentionContactRepository.js';
import { evaluateRetentionEligibility } from '../rules/RetentionEligibility.js';
import type { RetentionStatus } from '../rules/RetentionStatus.js';
import { retentionWindow, type RetentionWindow } from '../rules/RetentionWindow.js';

export type PriorityClientSort = 'appointmentAt' | 'probabilityNoShow';

export interface PriorityClientFilters {
  readonly modelKey: MlModelKey;
  readonly clinicId: number | null;
  readonly retentionStatus: RetentionStatus | null;
  readonly sort: PriorityClientSort;
  readonly direction: 'asc' | 'desc';
  readonly clinicScope: ClinicAccessScope;
}

export interface ResolvedPriorityClientQuery {
  readonly filters: PriorityClientFilters;
  readonly window: RetentionWindow;
  /** Política research vigente del modelo (null ⇒ clasificación experimental no disponible). */
  readonly policy: ExperimentalPolicyIdentity | null;
  /** Firma del cursor: orden, modelo, filtros y política (no se mezclan consultas). */
  readonly signature: string;
  readonly onlyReservationIds: readonly DecimalId[] | null;
  readonly excludeReservationIds: readonly DecimalId[] | null;
}

export interface PriorityClient {
  readonly reservation: Reservation;
  readonly score: ReservationScoreSummary;
  readonly experimentalRisk: ExperimentalRiskSummary;
  readonly retentionStatus: RetentionStatus;
  readonly contact: RetentionContactSummary | null;
}

export interface PriorityClientPage {
  readonly items: readonly PriorityClient[];
  readonly hasMore: boolean;
  /** Posición keyset de la última fila de la página (para el cursor o el siguiente lote). */
  readonly last: ReservationCursorPosition | null;
  readonly predictiveStoreAvailable: boolean;
}

export interface PriorityClientQueryDependencies {
  readonly reservations: Pick<ReservationRepository, 'list' | 'clinicExists'>;
  readonly scores: Pick<ReservationScoreReader, 'currentExperimentalPolicy' | 'rankLatest'>;
  readonly contacts: Pick<RetentionContactRepository, 'contactsFor'>;
  readonly mode: DataSourceMode;
}

/**
 * ÚNICA definición de «cliente prioritario para retención» (retention_priority_v1), compartida
 * por el listado paginado y la exportación. Reutiliza el listado de reservas existente (fuente
 * principal + reservas incorporadas, ranking global en el almacén, sin N+1) con: SCHEDULED,
 * ventana de 72 h, último score del modelo elegido con banda HIGH bajo la política vigente.
 * Solo lecturas: nunca genera predicciones ni llama a Python.
 */
export class PriorityClientQuery {
  constructor(private readonly deps: PriorityClientQueryDependencies) {}

  async resolve(filters: PriorityClientFilters, now: Date): Promise<ResolvedPriorityClientQuery> {
    if (
      filters.clinicId !== null &&
      !(await this.deps.reservations.clinicExists(filters.clinicId))
    ) {
      throw new InvalidReservationQueryException('UNKNOWN_CLINIC', 'clinicId', 'La sede no existe');
    }
    const evidence = allowedSnapshotEvidence(this.deps.mode);
    const policy = await this.deps.scores.currentExperimentalPolicy(filters.modelKey, evidence);
    const restriction = policy
      ? await this.retentionRestriction(filters, policy.policyHash)
      : { only: null, exclude: null };
    return {
      filters,
      window: retentionWindow(now),
      policy,
      signature: [
        'retention-priority',
        filters.sort,
        filters.direction,
        filters.modelKey,
        filters.clinicId ?? '-',
        filters.retentionStatus ?? '-',
        policy?.policyHash ?? '-',
      ].join('|'),
      onlyReservationIds: restriction.only,
      excludeReservationIds: restriction.exclude,
    };
  }

  async page(
    query: ResolvedPriorityClientQuery,
    after: ReservationCursorPosition | null,
    limit: number,
  ): Promise<PriorityClientPage> {
    if (query.policy === null) {
      return { items: [], hasMore: false, last: null, predictiveStoreAvailable: true };
    }
    const { filters, window } = query;
    const page = await this.deps.reservations.list({
      startInclusive: window.sourceStartInclusive,
      endExclusive: window.sourceEndExclusive,
      status: 'SCHEDULED',
      clinicId: filters.clinicId,
      clinicScope: filters.clinicScope,
      sortField: filters.sort,
      sortDirection: filters.direction,
      modelKey: filters.modelKey,
      probabilityRange: null,
      experimentalPolicyHash: query.policy.policyHash,
      experimentalRiskLevel: 'HIGH',
      snapshotEvidence: allowedSnapshotEvidence(this.deps.mode),
      onlyReservationIds: query.onlyReservationIds,
      excludeReservationIds: query.excludeReservationIds,
      after,
      limit,
    });
    const contacts = await this.deps.contacts.contactsFor(
      page.rows.map((row) => row.reservation.reservationId),
    );

    const items: PriorityClient[] = [];
    for (const row of page.rows) {
      const score = row.scores.find((candidate) => candidate.modelKey === filters.modelKey) ?? null;
      // Verificación final con la misma regla que el registro de contacto (defensa ante una
      // predicción nueva entre el ranking y la lectura): nunca se lista una fila no elegible.
      const reasons = evaluateRetentionEligibility({
        reservation: row.reservation,
        window,
        latestScore: score,
        currentPolicyHash: query.policy.policyHash,
        predictionRunId: null,
      });
      if (!score?.experimentalRisk || reasons.length > 0) continue;
      const contact = contacts.get(row.reservation.reservationId) ?? null;
      items.push({
        reservation: row.reservation,
        score,
        experimentalRisk: score.experimentalRisk,
        retentionStatus: contact ? 'CAMPAIGN_SENT' : 'PENDING',
        contact,
      });
    }

    const lastRow = page.rows.at(-1);
    return {
      items,
      hasMore: page.hasMore,
      last: lastRow
        ? {
            probability: filters.sort === 'appointmentAt' ? undefined : lastRow.sortProbability,
            appointmentAt: lastRow.reservation.appointmentAt,
            reservationId: lastRow.reservation.reservationId,
          }
        : null,
      predictiveStoreAvailable: page.predictiveStoreAvailable,
    };
  }

  /** Estado de gestión como restricción por ID sobre los candidatos HIGH (una lectura por lote). */
  private async retentionRestriction(
    filters: PriorityClientFilters,
    policyHash: string,
  ): Promise<{ only: DecimalId[] | null; exclude: DecimalId[] | null }> {
    if (filters.retentionStatus === null) return { only: null, exclude: null };
    const candidates = await this.deps.scores.rankLatest({
      modelKey: filters.modelKey,
      evidence: allowedSnapshotEvidence(this.deps.mode),
      probabilityRange: null,
      experimentalPolicyHash: policyHash,
      experimentalRiskLevel: 'HIGH',
    });
    const contacted = [
      ...(await this.deps.contacts.contactsFor(candidates.map((row) => row.reservationId))).keys(),
    ];
    return filters.retentionStatus === 'CAMPAIGN_SENT'
      ? { only: contacted, exclude: null }
      : { only: null, exclude: contacted };
  }
}
