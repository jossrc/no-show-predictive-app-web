import {
  toAppStoreException,
  type AppStoreQueryable,
  type SqlValue,
} from '../../../../../infrastructure/database/postgres/PredictiveAppDatabase.js';
import type {
  NewSpaceRecoveryOutcome,
  SpaceRecoveryOutcome,
} from '../../models/OperationalRecords.js';
import type {
  InsertOutcome,
  OperationalRecordListCriteria,
  OperationalRecordPage,
} from '../OperationalRecordListCriteria.js';
import type { SpaceRecoveryOutcomeRepository } from '../SpaceRecoveryOutcomeRepository.js';
import { buildListClause, toPage } from './OperationalListSql.js';

interface RecoveryRow {
  recovery_outcome_id: string;
  authorization_id: string;
  reservation_id: string;
  clinic_id: number;
  appointment_at: Date;
  space_recovered: boolean;
  recorded_at: Date;
  request_id: string;
}

const COLUMNS = `
  s.recovery_outcome_id::text AS recovery_outcome_id, s.authorization_id::text AS authorization_id,
  s.reservation_id::text AS reservation_id, s.clinic_id, s.appointment_at, s.space_recovered,
  s.recorded_at, s.request_id`;

function mapRow(row: RecoveryRow): SpaceRecoveryOutcome {
  return {
    recoveryOutcomeId: row.recovery_outcome_id,
    authorizationId: row.authorization_id,
    reservationId: row.reservation_id,
    clinicId: Number(row.clinic_id),
    appointmentAt: row.appointment_at,
    spaceRecovered: row.space_recovered,
    recordedAt: row.recorded_at,
    requestId: row.request_id,
    actorKind: 'INTERNAL_SERVICE',
    actorUserId: null,
  };
}

/** HU-08 sobre ml.app_space_recovery_outcomes (FK compuesta a la autorización HU-06). */
export class PostgresSpaceRecoveryOutcomeRepository implements SpaceRecoveryOutcomeRepository {
  constructor(private readonly db: AppStoreQueryable) {}

  async findByReservation(reservationId: string): Promise<SpaceRecoveryOutcome | null> {
    try {
      const [row] = await this.db.query<RecoveryRow>(
        `SELECT ${COLUMNS} FROM ml.app_space_recovery_outcomes s
         WHERE s.reservation_id = $1::bigint`,
        [reservationId],
      );
      return row ? mapRow(row) : null;
    } catch (error) {
      throw toAppStoreException('FindSpaceRecoveryOutcome', error);
    }
  }

  async insertIfAbsent(
    outcome: NewSpaceRecoveryOutcome,
  ): Promise<InsertOutcome<SpaceRecoveryOutcome>> {
    try {
      const inserted = await this.db.query<{ recovery_outcome_id: string }>(
        `INSERT INTO ml.app_space_recovery_outcomes (
           authorization_id, reservation_id, clinic_id, appointment_at, space_recovered,
           recorded_at, request_id, actor_kind, actor_user_id
         ) VALUES ($1::bigint, $2::bigint, $3::integer, $4, $5, $6, $7, 'INTERNAL_SERVICE', NULL)
         ON CONFLICT DO NOTHING
         RETURNING recovery_outcome_id::text AS recovery_outcome_id`,
        [
          outcome.authorizationId,
          outcome.reservationId,
          outcome.clinicId,
          outcome.appointmentAt,
          outcome.spaceRecovered,
          outcome.recordedAt,
          outcome.requestId,
        ],
      );
      const record = await this.findByReservation(outcome.reservationId);
      if (!record) throw new Error('Resultado de recuperación no localizado tras INSERT');
      return { record, created: inserted.length === 1 };
    } catch (error) {
      throw toAppStoreException('SaveSpaceRecoveryOutcome', error);
    }
  }

  async list(
    criteria: OperationalRecordListCriteria,
  ): Promise<OperationalRecordPage<SpaceRecoveryOutcome>> {
    const params: SqlValue[] = [];
    try {
      const rows = await this.db.query<RecoveryRow>(
        `SELECT ${COLUMNS} FROM ml.app_space_recovery_outcomes s
         ${buildListClause('s', criteria, params)}`,
        params,
      );
      return toPage(rows.map(mapRow), criteria.limit);
    } catch (error) {
      throw toAppStoreException('ListSpaceRecoveryOutcomes', error);
    }
  }
}
