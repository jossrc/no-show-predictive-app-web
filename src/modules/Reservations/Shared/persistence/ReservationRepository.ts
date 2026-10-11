import type { MlModelKey } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { SnapshotEvidenceSource } from '../../../../shared/data/DataSourceMode.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { ClinicAccessScope } from '../../../../shared/security/RequestPrincipal.js';
import type { Reservation } from '../models/Reservation.js';
import type { ReservationWithScores } from '../models/ReservationScoreSummary.js';
import type { ListableReservationStatus } from '../models/ReservationStatus.js';
import type { ReservationCursorPosition } from '../pagination/ReservationCursor.js';

export type ReservationSortField = 'appointmentAt' | 'probabilityNoShow';
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

/** Lectura de reservas sobre raw_flow/analytics (solo lectura) + scores persistidos en ml. */
export interface ReservationRepository {
  list(criteria: ReservationListCriteria): Promise<ReservationListPage>;
  findById(reservationId: DecimalId): Promise<Reservation | null>;
  findWithScores(
    reservationId: DecimalId,
    snapshotEvidence: SnapshotEvidenceSource,
  ): Promise<ReservationWithScores | null>;
  clinicExists(clinicId: number): Promise<boolean>;
}
