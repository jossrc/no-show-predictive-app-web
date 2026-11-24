import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { ClinicAccessScope } from '../../../../shared/security/RequestPrincipal.js';
import { LIMA_TIME_ZONE } from '../../../../shared/time/LimaTime.js';
import { InvalidReservationQueryException } from '../../../Reservations/Shared/errors/InvalidReservationQueryException.js';
import {
  decodeReservationCursor,
  encodeReservationCursor,
} from '../../../Reservations/Shared/pagination/ReservationCursor.js';
import type { ReservationRepository } from '../../../Reservations/Shared/persistence/ReservationRepository.js';
import { resolveListPeriod } from '../../../Reservations/Shared/validation/ResolveListPeriod.js';
import type {
  OperationalRecordListCriteria,
  OperationalRecordPage,
} from '../persistence/OperationalRecordListCriteria.js';

/** Entrada común de los listados Sprint 02 (fechas de CITA en el calendario de Lima). */
export interface RecordListInput {
  readonly from: string;
  readonly to: string;
  readonly clinicId: number | null;
  readonly limit: number;
  readonly cursor: string | null;
  readonly clinicScope: ClinicAccessScope;
}

export interface RecordListPeriod {
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
  readonly startInclusive: Date;
  readonly endExclusive: Date;
}

export interface RecordListPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly limit: number;
  readonly period: RecordListPeriod;
}

export interface ResolvedRecordListQuery {
  readonly criteria: OperationalRecordListCriteria;
  readonly period: RecordListPeriod;
  readonly signature: string;
}

/**
 * Período Lima (máx. 92 días, mismas reglas que GET /reservations), sede existente y cursor
 * opaco firmado con el tipo de listado y sus filtros (no se reutiliza entre consultas).
 */
export async function resolveRecordListQuery(
  kind: string,
  input: RecordListInput,
  clinics: Pick<ReservationRepository, 'clinicExists'>,
): Promise<ResolvedRecordListQuery> {
  const range = resolveListPeriod(input.from, input.to);
  if (input.clinicId !== null && !(await clinics.clinicExists(input.clinicId))) {
    throw new InvalidReservationQueryException('UNKNOWN_CLINIC', 'clinicId', 'La sede no existe');
  }
  const signature = [kind, input.from, input.to, input.clinicId ?? '-'].join('|');
  const after = input.cursor ? decodeReservationCursor(input.cursor, signature) : null;
  return {
    signature,
    period: { from: input.from, to: input.to, timeZone: LIMA_TIME_ZONE, ...range },
    criteria: {
      ...range,
      clinicId: input.clinicId,
      clinicScope: input.clinicScope,
      after: after
        ? { appointmentAt: after.appointmentAt, reservationId: after.reservationId }
        : null,
      limit: input.limit,
    },
  };
}

export function toRecordListPage<T extends { appointmentAt: Date; reservationId: DecimalId }>(
  query: ResolvedRecordListQuery,
  page: OperationalRecordPage<T>,
): RecordListPage<T> {
  const last = page.rows.at(-1);
  return {
    items: page.rows,
    nextCursor:
      page.hasMore && last
        ? encodeReservationCursor(
            {
              probability: undefined,
              appointmentAt: last.appointmentAt,
              reservationId: last.reservationId,
            },
            query.signature,
          )
        : null,
    limit: query.criteria.limit,
    period: query.period,
  };
}
