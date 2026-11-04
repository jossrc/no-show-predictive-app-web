import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { ClinicAccessScope } from '../../../../shared/security/RequestPrincipal.js';

/**
 * Listado de registros propios por fecha de CITA (calendario Lima, intervalo semiabierto
 * `[startInclusive, endExclusive)`), sede y alcance del principal (filtro server-side), con
 * keyset estable `(appointmentAt, reservationId)` ascendente.
 */
export interface OperationalRecordListCriteria {
  readonly startInclusive: Date;
  readonly endExclusive: Date;
  readonly clinicId: number | null;
  readonly clinicScope: ClinicAccessScope;
  readonly after: { readonly appointmentAt: Date; readonly reservationId: DecimalId } | null;
  readonly limit: number;
}

export interface OperationalRecordPage<T> {
  readonly rows: readonly T[];
  readonly hasMore: boolean;
}

/** Resultado de un INSERT idempotente: el registro vigente y si esta petición lo creó. */
export interface InsertOutcome<T> {
  readonly record: T;
  readonly created: boolean;
}
