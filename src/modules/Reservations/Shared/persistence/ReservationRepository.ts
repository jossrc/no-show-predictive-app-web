import type { MlModelKey } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { SnapshotEvidenceSource } from '../../../../shared/data/DataSourceMode.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { ClinicAccessScope } from '../../../../shared/security/RequestPrincipal.js';
import type { Reservation } from '../models/Reservation.js';
import type {
  ExperimentalRiskLevel,
  ReservationWithScores,
} from '../models/ReservationScoreSummary.js';
import type { ListableReservationStatus } from '../models/ReservationStatus.js';
import type { ReservationCursorPosition } from '../pagination/ReservationCursor.js';

/**
 * - appointmentAt: cronológico (fuente PostgreSQL).
 * - probabilityNoShow: score exploratorio del modelo elegido, NULLS LAST.
 * - experimentalRisk: banda experimental del modelo elegido bajo UNA política research
 *   (`experimentalPolicyHash`); dentro de una política la banda es monótona en el score, así que
 *   el orden es por score entre las reservas clasificadas con esa política y el resto va al final.
 */
export type ReservationSortField = 'appointmentAt' | 'probabilityNoShow' | 'experimentalRisk';
export type SortDirection = 'asc' | 'desc';

export interface ProbabilityRange {
  readonly minInclusive: number;
  readonly maxExclusive: number;
}

export interface ReservationListCriteria {
  readonly startInclusive: Date;
  readonly endExclusive: Date;
  readonly status: ListableReservationStatus;
  readonly clinicId: number | null;
  readonly clinicScope: ClinicAccessScope;
  readonly sortField: ReservationSortField;
  readonly sortDirection: SortDirection;
  /** Modelo cuyo score persistido se usa para ordenar/filtrar. */
  readonly modelKey: MlModelKey;
  /** Solo proviene de una política de riesgo APROBADA; null en Sprint 01 real. */
  readonly probabilityRange: ProbabilityRange | null;
  /**
   * Política research (hash) con la que se filtra/ordena por banda experimental; las reservas
   * cuyo último score del modelo usa otra política (o v1) no se mezclan: quedan sin clasificar.
   */
  readonly experimentalPolicyHash: string | null;
  /** Filtro por banda EXPERIMENTAL del modelo elegido (exige `experimentalPolicyHash`). */
  readonly experimentalRiskLevel: ExperimentalRiskLevel | null;
  readonly snapshotEvidence: SnapshotEvidenceSource;
  readonly after: ReservationCursorPosition | null;
  readonly limit: number;
}

export interface ReservationListRow extends ReservationWithScores {
  /** Valor de orden del modelo solicitado (null = no evaluado; nunca 0). */
  readonly sortProbability: number | null;
}

export interface ReservationListPage {
  readonly rows: readonly ReservationListRow[];
  readonly hasMore: boolean;
  readonly predictiveStoreAvailable: boolean;
}

/**
 * Reservas de la fuente PostgreSQL (solo lectura) enriquecidas con los scores del almacén
 * predictivo local. Implementación runtime: ScoredReservationRepository.
 */
export interface ReservationRepository {
  list(criteria: ReservationListCriteria): Promise<ReservationListPage>;
  findById(reservationId: DecimalId): Promise<Reservation | null>;
  findWithScores(
    reservationId: DecimalId,
    snapshotEvidence: SnapshotEvidenceSource,
  ): Promise<ReservationWithScores | null>;
  clinicExists(clinicId: number): Promise<boolean>;
}
