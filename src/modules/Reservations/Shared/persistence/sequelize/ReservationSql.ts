import type { ReservationListCriteria } from '../ReservationRepository.js';

/**
 * SQL parametrizado de reservas. Esquemas, tablas, columnas y ORDER BY son literales fijos
 * (whitelist): ningún valor del usuario se interpola en el texto SQL.
 * Columnas verificadas en information_schema (ver docs/sprint-01/source_inventory.md).
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

/** Último score por modelo (DISTINCT ON) de snapshots con la evidencia admitida en el modo activo. */
function scoresLateral(evidenceParam: string, reservationExpr: string): string {
  return `
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
             jsonb_build_object(
               'modelKey', latest.model_key,
               'modelVersion', latest.model_version,
               'modelHash', latest.model_hash,
               'probabilityNoShow', latest.probability_no_show,
               'scoredAt', latest.scored_at,
               'predictionRunId', latest.run_uid
             ) ORDER BY latest.model_key
           ) AS items
    FROM (
      SELECT DISTINCT ON (r.model_key)
             r.model_key, r.model_version, r.model_hash, r.probability_no_show, r.scored_at,
             pr.run_uid::text AS run_uid
      FROM ml.prediction_model_results r
      JOIN ml.booking_feature_snapshots s
        ON s.snapshot_id = r.snapshot_id AND s.evidence_source = ${evidenceParam}
      JOIN ml.prediction_runs pr ON pr.run_id = r.run_id
      WHERE r.reservation_id = ${reservationExpr}
      ORDER BY r.model_key, r.scored_at DESC, r.result_id DESC
    ) latest
  ) scores ON true`;
}

function snapshotExists(evidenceParam: string, reservationExpr: string): string {
  return `
  EXISTS (
    SELECT 1 FROM ml.booking_feature_snapshots bs
    WHERE bs.reservation_id = ${reservationExpr} AND bs.evidence_source = ${evidenceParam}
  ) AS has_usable_snapshot`;
}

class BindList {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

function orderBy(criteria: ReservationListCriteria, prefix: { at: string; id: string; p: string }) {
  const direction = criteria.sortDirection === 'desc' ? 'DESC' : 'ASC';

  if (criteria.sortField === 'probabilityNoShow') {
    return `${prefix.p} ${direction} NULLS LAST, ${prefix.at} ASC, ${prefix.id} ASC`;
  }
  return `${prefix.at} ${direction}, ${prefix.id} ${direction}`;
}

function keysetCondition(criteria: ReservationListCriteria, bind: BindList): string | null {
  const after = criteria.after;
  if (!after) return null;

  const at = bind.add(after.appointmentAt);
  const id = bind.add(after.reservationId);
  const tieBreakAfter = `(o.appointment_at, o.appointment_id) > (${at}::timestamptz, ${id}::bigint)`;

  if (criteria.sortField === 'appointmentAt') {
    const comparator = criteria.sortDirection === 'desc' ? '<' : '>';
    return `(o.appointment_at, o.appointment_id) ${comparator} (${at}::timestamptz, ${id}::bigint)`;
  }

  if (after.probability === null || after.probability === undefined) {
    return `(sel.probability_no_show IS NULL AND ${tieBreakAfter})`;
  }

  const p = bind.add(after.probability);
  const comparator = criteria.sortDirection === 'desc' ? '<' : '>';
  return `(sel.probability_no_show IS NULL
        OR sel.probability_no_show ${comparator} ${p}::double precision
        OR (sel.probability_no_show = ${p}::double precision AND ${tieBreakAfter}))`;
}

/**
 * Una sola consulta paginada (sin N+1): la página se resuelve primero con LIMIT y solo después
 * se adjuntan scores/eventos a esas filas.
 */
export function buildReservationListQuery(
  criteria: ReservationListCriteria,
  predictiveStoreAvailable: boolean,
): BuiltQuery {
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

  // Solo se enlaza si se usa: PostgreSQL rechaza parámetros enviados y no referenciados.
  const evidence = predictiveStoreAvailable ? bind.add(criteria.snapshotEvidence) : '';
  const sortLateral = predictiveStoreAvailable
    ? `LEFT JOIN LATERAL (
        SELECT r.probability_no_show
        FROM ml.prediction_model_results r
        JOIN ml.booking_feature_snapshots s
          ON s.snapshot_id = r.snapshot_id AND s.evidence_source = ${evidence}
        WHERE r.reservation_id = o.appointment_id AND r.model_key = ${bind.add(criteria.modelKey)}
        ORDER BY r.scored_at DESC, r.result_id DESC
        LIMIT 1
      ) sel ON true`
    : `LEFT JOIN LATERAL (SELECT NULL::double precision AS probability_no_show) sel ON true`;

  if (criteria.probabilityRange) {
    where.push(
      `sel.probability_no_show >= ${bind.add(criteria.probabilityRange.minInclusive)}::double precision`,
      `sel.probability_no_show < ${bind.add(criteria.probabilityRange.maxExclusive)}::double precision`,
    );
  }

  const keyset = keysetCondition(criteria, bind);
  if (keyset) where.push(keyset);

  const limit = bind.add(criteria.limit + 1);
  const innerOrder = orderBy(criteria, {
    at: 'o.appointment_at',
    id: 'o.appointment_id',
    p: 'sel.probability_no_show',
  });
  const outerOrder = orderBy(criteria, {
    at: 'page.appointment_at',
    id: 'page.appointment_id',
    p: 'page.sort_probability',
  });

  const sql = `
WITH page AS (
  SELECT o.appointment_id, o.client_id, o.clinic_id, o.appointment_at, o.created_at_source,
         o.outcome, o.classification_detail, o.classification_cutoff_at,
         sel.probability_no_show AS sort_probability
  FROM analytics.appointment_outcomes o
  ${sortLateral}
  WHERE ${where.join('\n    AND ')}
  ORDER BY ${innerOrder}
  LIMIT ${limit}
)
SELECT ${RESERVATION_COLUMNS.replaceAll(' o.', ' page.')},
  page.sort_probability AS sort_probability,
  ${RESCHEDULE_EXISTS.replaceAll('o.appointment_id', 'page.appointment_id')},
  ${
    predictiveStoreAvailable
      ? `${snapshotExists(evidence, 'page.appointment_id')},
  COALESCE(scores.items, '[]'::jsonb) AS scores`
      : `false AS has_usable_snapshot,
  '[]'::jsonb AS scores`
  }
FROM page
${predictiveStoreAvailable ? scoresLateral(evidence, 'page.appointment_id') : ''}
ORDER BY ${outerOrder}`;

  return { sql, bind: bind.values };
}

export function buildReservationByIdQuery(
  reservationId: string,
  options: { includeScores: boolean; evidence?: string },
): BuiltQuery {
  const bind = new BindList();
  const id = bind.add(reservationId);

  if (!options.includeScores) {
    return {
      sql: `
SELECT ${RESERVATION_COLUMNS},
  NULL::double precision AS sort_probability,
  ${RESCHEDULE_EXISTS},
  false AS has_usable_snapshot,
  '[]'::jsonb AS scores
FROM analytics.appointment_outcomes o
WHERE o.appointment_id = ${id}::bigint`,
      bind: bind.values,
    };
  }

  const evidence = bind.add(options.evidence);
  return {
    sql: `
SELECT ${RESERVATION_COLUMNS},
  NULL::double precision AS sort_probability,
  ${RESCHEDULE_EXISTS},
  ${snapshotExists(evidence, 'o.appointment_id')},
  COALESCE(scores.items, '[]'::jsonb) AS scores
FROM analytics.appointment_outcomes o
${scoresLateral(evidence, 'o.appointment_id')}
WHERE o.appointment_id = ${id}::bigint`,
    bind: bind.values,
  };
}

export const CLINIC_EXISTS_SQL = `SELECT 1 AS present FROM raw_flow.x_config_clinics WHERE "ClinicID" = $1::integer`;
