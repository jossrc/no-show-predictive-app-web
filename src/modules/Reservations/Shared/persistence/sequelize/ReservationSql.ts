import type { ReservationSourceCriteria } from '../ReservationSource.js';

/**
 * SQL parametrizado de reservas sobre la FUENTE (raw_flow/analytics, solo lectura). Esquemas,
 * tablas, columnas y ORDER BY son literales fijos (whitelist): ningún valor del usuario se
 * interpola en el texto SQL. No referencia el schema ml: los scores viven en el almacén local
 * (ADR-006). Columnas verificadas en information_schema (docs/sprint-01/source_inventory.md).
 */
export interface BuiltQuery {
  readonly sql: string;
  readonly bind: unknown[];
}

const RESERVATION_COLUMNS = `
  o.appointment_id::text AS reservation_id,
  o.client_id::text AS client_id,
  o.clinic_id AS clinic_id,
  o.appointment_at AS appointment_at,
  o.created_at_source AS created_at_source,
  o.outcome::text AS outcome,
  o.classification_detail::text AS classification_detail,
  o.classification_cutoff_at AS classification_cutoff_at`;

/**
 * Reprogramación: evento RESCHEDULED del ETL 03 o, de forma equivalente, la copia desplazada
 * en raw_flow.diary_gen (DiaryGDelayed=-1 apuntando a esta cita), que es su fuente. Ambas ramas
 * usan índices (idx_appointment_events_app parcial e idx_raw_diary_delayed_id).
 */
const RESCHEDULE_EXISTS = `
  (EXISTS (
     SELECT 1 FROM analytics.appointment_events e
     WHERE e.appointment_id = o.appointment_id AND e.event_type = 'RESCHEDULED'
       AND e.event_at IS NOT NULL
   ) OR EXISTS (
     SELECT 1 FROM raw_flow.diary_gen h
     WHERE h."DiaryGDelayedID" = o.appointment_id AND h."DiaryGDelayed" = -1
   )) AS has_reschedule_event`;

class BindList {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/**
 * Una sola consulta paginada (sin N+1): la página se resuelve primero con LIMIT y solo después
 * se adjuntan los eventos de reprogramación a esas filas. Orden cronológico estable
 * (appointment_at, appointment_id) en la dirección pedida, con keyset sobre ese mismo par.
 */
export function buildReservationListQuery(criteria: ReservationSourceCriteria): BuiltQuery {
  const bind = new BindList();
  const where: string[] = [
    criteria.status === 'SCHEDULED'
      ? `o.outcome = 'FUTURE'`
      : `o.classification_detail = 'FUTURE_CANCELLED'`,
    `o.appointment_at >= ${bind.add(criteria.startInclusive)}::timestamptz`,
    `o.appointment_at < ${bind.add(criteria.endExclusive)}::timestamptz`,
  ];

  if (criteria.clinicId !== null) {
    where.push(`o.clinic_id = ${bind.add(criteria.clinicId)}::integer`);
  }
  if (criteria.clinicScope.kind === 'CLINICS') {
    where.push(`o.clinic_id = ANY(${bind.add([...criteria.clinicScope.clinicIds])}::integer[])`);
  }
  if (criteria.onlyIds !== null) {
    where.push(`o.appointment_id = ANY(${bind.add([...criteria.onlyIds])}::bigint[])`);
  }
  if (criteria.excludeIds !== null && criteria.excludeIds.length > 0) {
    where.push(`NOT (o.appointment_id = ANY(${bind.add([...criteria.excludeIds])}::bigint[]))`);
  }

  const descending = criteria.direction === 'desc';
  if (criteria.after) {
    const at = bind.add(criteria.after.appointmentAt);
    const id = bind.add(criteria.after.reservationId);
    where.push(
      `(o.appointment_at, o.appointment_id) ${descending ? '<' : '>'} (${at}::timestamptz, ${id}::bigint)`,
    );
  }

  const direction = descending ? 'DESC' : 'ASC';
  const limit = bind.add(criteria.limit + 1);
  const sql = `
WITH page AS (
  SELECT o.appointment_id, o.client_id, o.clinic_id, o.appointment_at, o.created_at_source,
         o.outcome, o.classification_detail, o.classification_cutoff_at
  FROM analytics.appointment_outcomes o
  WHERE ${where.join('\n    AND ')}
  ORDER BY o.appointment_at ${direction}, o.appointment_id ${direction}
  LIMIT ${limit}
)
SELECT ${RESERVATION_COLUMNS.replaceAll(' o.', ' page.')},
  ${RESCHEDULE_EXISTS.replaceAll('o.appointment_id', 'page.appointment_id')}
FROM page
ORDER BY page.appointment_at ${direction}, page.appointment_id ${direction}`;

  return { sql, bind: bind.values };
}

export function buildReservationByIdQuery(reservationId: string): BuiltQuery {
  return {
    sql: `
SELECT ${RESERVATION_COLUMNS},
  ${RESCHEDULE_EXISTS}
FROM analytics.appointment_outcomes o
WHERE o.appointment_id = $1::bigint`,
    bind: [reservationId],
  };
}

export const CLINIC_EXISTS_SQL = `SELECT 1 AS present FROM raw_flow.x_config_clinics WHERE "ClinicID" = $1::integer`;
