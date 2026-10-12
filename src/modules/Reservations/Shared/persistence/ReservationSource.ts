import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { ClinicAccessScope } from '../../../../shared/security/RequestPrincipal.js';
import type { Reservation } from '../models/Reservation.js';
import type { ListableReservationStatus } from '../models/ReservationStatus.js';

/** Filtros de negocio del listado (siempre aplicados en la FUENTE, nunca en el almacén local). */
export interface ReservationSourceFilters {
  readonly startInclusive: Date;
  readonly endExclusive: Date;
  readonly status: ListableReservationStatus;
  readonly clinicId: number | null;
  readonly clinicScope: ClinicAccessScope;
}

export interface ReservationSourceCriteria extends ReservationSourceFilters {
  /** Orden cronológico (appointment_at, appointment_id) en esta dirección. */
  readonly direction: 'asc' | 'desc';
  /** Restringe a estos IDs (candidatos puntuados); null = sin restricción. */
  readonly onlyIds: readonly DecimalId[] | null;
  /** Excluye estos IDs (ya listados en la parte puntuada del ranking). */
  readonly excludeIds: readonly DecimalId[] | null;
  readonly after: { readonly appointmentAt: Date; readonly reservationId: DecimalId } | null;
  readonly limit: number;
}

export interface ReservationSourcePage {
  readonly rows: readonly Reservation[];
  readonly hasMore: boolean;
}

/**
 * Fuente de reservas: PostgreSQL raw_flow/analytics en SOLO LECTURA (o fixtures sintéticas
 * versionadas en SYNTHETIC_DEMO_ONLY). No conoce scores ni el schema ml.
 */
export interface ReservationSource {
  list(criteria: ReservationSourceCriteria): Promise<ReservationSourcePage>;
  findById(reservationId: DecimalId): Promise<Reservation | null>;
  clinicExists(clinicId: number): Promise<boolean>;
}
