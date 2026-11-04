import {
  toAppStoreException,
  type AppStoreQueryable,
} from '../../../../../infrastructure/database/postgres/PredictiveAppDatabase.js';
import type { MlModelKey } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type {
  AttendanceStatus,
  ReservationOperationalStatus,
} from '../../../../Reservations/Shared/models/ReservationOperationalStatus.js';
import type { ReservationOperationalStatusReader } from '../../../../Reservations/Shared/persistence/ReservationOperationalStatusReader.js';

interface StatusRow {
  reservation_id: string;
  authorization_id: string | null;
  enabled_at: Date | null;
  model_key: MlModelKey | null;
  prediction_run_uid: string | null;
  attendance_status: AttendanceStatus | null;
  attendance_recorded_at: Date | null;
  attendance_run_uid: string | null;
  recovery_authorization_id: string | null;
  space_recovered: boolean | null;
  recovery_recorded_at: Date | null;
}

/**
 * Resumen HU-06/07/08 de una página de reservas en UNA consulta (cada tabla tiene UNIQUE por
 * reserva, así que los LEFT JOIN no multiplican filas).
 */
const STATUS_SQL = `
SELECT ids.reservation_id::text AS reservation_id,
       a.authorization_id::text AS authorization_id, a.enabled_at, a.model_key,
       a.prediction_run_uid::text AS prediction_run_uid,
       o.attendance_status, o.recorded_at AS attendance_recorded_at,
       o.prediction_run_uid::text AS attendance_run_uid,
       s.authorization_id::text AS recovery_authorization_id, s.space_recovered,
       s.recorded_at AS recovery_recorded_at
FROM unnest($1::bigint[]) AS ids(reservation_id)
LEFT JOIN ml.app_overbooking_authorizations a ON a.reservation_id = ids.reservation_id
LEFT JOIN ml.app_attendance_outcomes o ON o.reservation_id = ids.reservation_id
LEFT JOIN ml.app_space_recovery_outcomes s ON s.reservation_id = ids.reservation_id
WHERE a.reservation_id IS NOT NULL OR o.reservation_id IS NOT NULL OR s.reservation_id IS NOT NULL`;

export class PostgresOperationalStatusReader implements ReservationOperationalStatusReader {
  constructor(private readonly db: AppStoreQueryable) {}

  async statusesFor(
    reservationIds: readonly DecimalId[],
  ): Promise<ReadonlyMap<DecimalId, ReservationOperationalStatus>> {
    const statuses = new Map<DecimalId, ReservationOperationalStatus>();
    if (reservationIds.length === 0) return statuses;
    try {
      const rows = await this.db.query<StatusRow>(STATUS_SQL, [[...new Set(reservationIds)]]);
      for (const row of rows) {
        statuses.set(row.reservation_id, {
          overbooking:
            row.authorization_id && row.enabled_at && row.model_key && row.prediction_run_uid
              ? {
                  authorizationId: row.authorization_id,
                  enabledAt: row.enabled_at,
                  modelKey: row.model_key,
                  predictionRunId: row.prediction_run_uid,
                }
              : null,
          attendanceOutcome:
            row.attendance_status && row.attendance_recorded_at && row.attendance_run_uid
              ? {
                  attendanceStatus: row.attendance_status,
                  recordedAt: row.attendance_recorded_at,
                  predictionRunId: row.attendance_run_uid,
                }
              : null,
          spaceRecoveryOutcome:
            row.recovery_authorization_id &&
            row.recovery_recorded_at &&
            row.space_recovered !== null
              ? {
                  authorizationId: row.recovery_authorization_id,
                  spaceRecovered: row.space_recovered,
                  recordedAt: row.recovery_recorded_at,
                }
              : null,
        });
      }
      return statuses;
    } catch (error) {
      throw toAppStoreException('ReadOperationalStatus', error);
    }
  }
}
