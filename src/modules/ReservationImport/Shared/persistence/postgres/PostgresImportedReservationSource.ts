import {
  toAppStoreException,
  type AppStoreQueryable,
  type SqlValue,
} from '../../../../../infrastructure/database/postgres/PredictiveAppDatabase.js';
import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { Reservation } from '../../../../Reservations/Shared/models/Reservation.js';
import type {
  ReservationSource,
  ReservationSourceCriteria,
  ReservationSourcePage,
} from '../../../../Reservations/Shared/persistence/ReservationSource.js';
import {
  IMPORTED_COLUMNS,
  mapImportedRow,
  toSourceReservation,
  type ImportedRow,
} from './ImportedReservationRows.js';

/**
 * Reservas incorporadas como `ReservationSource`, con la MISMA semántica que la fuente principal
 * (estado, período, sede, alcance, IDs y keyset (appointment_at, reservation_id)), para que el
 * listado, el detalle y la predicción existentes las incluyan sin un flujo paralelo.
 */
export class PostgresImportedReservationSource implements ReservationSource {
  constructor(private readonly db: AppStoreQueryable) {}

  async list(criteria: ReservationSourceCriteria): Promise<ReservationSourcePage> {
    if (criteria.onlyIds !== null && criteria.onlyIds.length === 0) {
      return { rows: [], hasMore: false };
    }
    const params: SqlValue[] = [];
    const next = (value: SqlValue): string => {
      params.push(value);
      return `$${params.length}`;
    };
    const where = [
      `i.reservation_status = ${next(criteria.status)}`,
      `i.appointment_at >= ${next(criteria.startInclusive)}`,
      `i.appointment_at < ${next(criteria.endExclusive)}`,
    ];
    if (criteria.clinicId !== null) where.push(`i.clinic_id = ${next(criteria.clinicId)}::integer`);
    if (criteria.clinicScope.kind === 'CLINICS') {
      where.push(
        `i.clinic_id = ANY(${next(criteria.clinicScope.clinicIds.map(String))}::integer[])`,
      );
    }
    if (criteria.onlyIds !== null) {
      where.push(`i.reservation_id = ANY(${next([...criteria.onlyIds])}::bigint[])`);
    }
    if (criteria.excludeIds !== null && criteria.excludeIds.length > 0) {
      where.push(`NOT (i.reservation_id = ANY(${next([...criteria.excludeIds])}::bigint[]))`);
    }
    const descending = criteria.direction === 'desc';
    if (criteria.after) {
      where.push(
        `(i.appointment_at, i.reservation_id) ${descending ? '<' : '>'} (${next(criteria.after.appointmentAt)}, ${next(criteria.after.reservationId)}::bigint)`,
      );
    }
    const direction = descending ? 'DESC' : 'ASC';
    try {
      const rows = await this.db.query<ImportedRow>(
        `SELECT ${IMPORTED_COLUMNS} FROM ml.app_imported_reservations i
         WHERE ${where.join(' AND ')}
         ORDER BY i.appointment_at ${direction}, i.reservation_id ${direction}
         LIMIT ${next(criteria.limit + 1)}`,
        params,
      );
      return {
        rows: rows.slice(0, criteria.limit).map((row) => toSourceReservation(mapImportedRow(row))),
        hasMore: rows.length > criteria.limit,
      };
    } catch (error) {
      throw toAppStoreException('ListImportedReservations', error);
    }
  }

  async findById(reservationId: DecimalId): Promise<Reservation | null> {
    try {
      const [row] = await this.db.query<ImportedRow>(
        `SELECT ${IMPORTED_COLUMNS} FROM ml.app_imported_reservations i
         WHERE i.reservation_id = $1::bigint`,
        [reservationId],
      );
      return row ? toSourceReservation(mapImportedRow(row)) : null;
    } catch (error) {
      throw toAppStoreException('FindImportedReservation', error);
    }
  }

  async clinicExists(clinicId: number): Promise<boolean> {
    try {
      const rows = await this.db.query<{ present: number }>(
        `SELECT 1 AS present FROM ml.app_imported_reservations WHERE clinic_id = $1::integer LIMIT 1`,
        [clinicId],
      );
      return rows.length > 0;
    } catch (error) {
      throw toAppStoreException('ImportedClinicExists', error);
    }
  }
}
