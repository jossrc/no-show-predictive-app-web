import type { SqlValue } from '../../../../../infrastructure/database/postgres/PredictiveAppDatabase.js';
import type { OperationalRecordListCriteria } from '../OperationalRecordListCriteria.js';

/**
 * WHERE/ORDER/LIMIT comunes de los listados Sprint 02. El alias y las columnas son literales
 * fijos del código; los valores del usuario viajan siempre como parámetros ($n).
 */
export function buildListClause(
  alias: string,
  criteria: OperationalRecordListCriteria,
  params: SqlValue[],
): string {
  const next = (value: SqlValue): string => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [
    `${alias}.appointment_at >= ${next(criteria.startInclusive)}`,
    `${alias}.appointment_at < ${next(criteria.endExclusive)}`,
  ];
  if (criteria.clinicId !== null) {
    where.push(`${alias}.clinic_id = ${next(criteria.clinicId)}::integer`);
  }
  if (criteria.clinicScope.kind === 'CLINICS') {
    where.push(
      `${alias}.clinic_id = ANY(${next([...criteria.clinicScope.clinicIds].map(String))}::integer[])`,
    );
  }
  if (criteria.after) {
    where.push(
      `(${alias}.appointment_at, ${alias}.reservation_id) > (${next(criteria.after.appointmentAt)}, ${next(criteria.after.reservationId)}::bigint)`,
    );
  }
  return `WHERE ${where.join(' AND ')}
    ORDER BY ${alias}.appointment_at ASC, ${alias}.reservation_id ASC
    LIMIT ${next(criteria.limit + 1)}`;
}

export function toPage<T>(rows: readonly T[], limit: number): { rows: T[]; hasMore: boolean } {
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}
