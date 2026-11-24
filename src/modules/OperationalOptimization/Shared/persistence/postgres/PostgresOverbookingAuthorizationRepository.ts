import {
  toAppStoreException,
  type AppStoreQueryable,
  type SqlValue,
} from '../../../../../infrastructure/database/postgres/PredictiveAppDatabase.js';
import type { MlModelKey } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type {
  NewOverbookingAuthorization,
  OverbookingAuthorization,
} from '../../models/OperationalRecords.js';
import type {
  InsertOutcome,
  OperationalRecordListCriteria,
  OperationalRecordPage,
} from '../OperationalRecordListCriteria.js';
import type { OverbookingAuthorizationRepository } from '../OverbookingAuthorizationRepository.js';
import { buildListClause, toPage } from './OperationalListSql.js';

interface AuthorizationRow {
  authorization_id: string;
  reservation_id: string;
  clinic_id: number;
  appointment_at: Date;
  status: 'ENABLED';
  enabled_at: Date;
  request_id: string;
  actor_kind: 'INTERNAL_SERVICE';
  prediction_run_uid: string;
  prediction_result_id: string;
  model_key: MlModelKey;
  model_version: string;
  research_policy_hash: string;
  research_policy_version: string;
  risk_band_at_authorization: 'HIGH';
  probability_no_show_at_authorization: number;
  scored_at: Date;
  eligibility_rule_version: string;
}

const COLUMNS = `
  a.authorization_id::text AS authorization_id, a.reservation_id::text AS reservation_id,
  a.clinic_id, a.appointment_at, a.status, a.enabled_at, a.request_id, a.actor_kind,
  a.prediction_run_uid::text AS prediction_run_uid,
  a.prediction_result_id::text AS prediction_result_id, a.model_key, a.model_version,
  a.research_policy_hash, a.research_policy_version, a.risk_band_at_authorization,
  a.probability_no_show_at_authorization, a.scored_at, a.eligibility_rule_version`;

function mapRow(row: AuthorizationRow): OverbookingAuthorization {
  return {
    authorizationId: row.authorization_id,
    reservationId: row.reservation_id,
    clinicId: Number(row.clinic_id),
    appointmentAt: row.appointment_at,
    status: row.status,
    enabledAt: row.enabled_at,
    requestId: row.request_id,
    actorKind: row.actor_kind,
    actorUserId: null,
    predictionRunId: row.prediction_run_uid,
    predictionResultId: row.prediction_result_id,
    modelKey: row.model_key,
    modelVersion: row.model_version,
    researchPolicyHash: row.research_policy_hash,
    researchPolicyVersion: row.research_policy_version,
    riskBandAtAuthorization: row.risk_band_at_authorization,
    probabilityNoShowAtAuthorization: Number(row.probability_no_show_at_authorization),
    scoredAt: row.scored_at,
    eligibilityRuleVersion: row.eligibility_rule_version,
  };
}

/** HU-06 sobre ml.app_overbooking_authorizations (solo SELECT/INSERT; FK a la predicción). */
export class PostgresOverbookingAuthorizationRepository implements OverbookingAuthorizationRepository {
  constructor(private readonly db: AppStoreQueryable) {}

  async findByReservation(reservationId: string): Promise<OverbookingAuthorization | null> {
    try {
      const [row] = await this.db.query<AuthorizationRow>(
        `SELECT ${COLUMNS} FROM ml.app_overbooking_authorizations a
         WHERE a.reservation_id = $1::bigint`,
        [reservationId],
      );
      return row ? mapRow(row) : null;
    } catch (error) {
      throw toAppStoreException('FindOverbookingAuthorization', error);
    }
  }

  async insertIfAbsent(
    authorization: NewOverbookingAuthorization,
  ): Promise<InsertOutcome<OverbookingAuthorization>> {
    try {
      // run_id interno se resuelve desde el run_uid público; las FK compuestas garantizan que
      // resultado, run, modelo y reserva pertenecen a la misma predicción.
      const inserted = await this.db.query<{ authorization_id: string }>(
        `INSERT INTO ml.app_overbooking_authorizations (
           reservation_id, clinic_id, appointment_at, status, enabled_at, request_id, actor_kind,
           actor_user_id, prediction_run_id, prediction_run_uid, prediction_result_id, model_key,
           model_version, research_policy_hash, research_policy_version,
           risk_band_at_authorization, probability_no_show_at_authorization, scored_at,
           eligibility_rule_version
         )
         SELECT $1::bigint, $2::integer, $3, 'ENABLED', $4, $5, 'INTERNAL_SERVICE', NULL,
                pr.run_id, pr.run_uid, $7::bigint, $8, $9, $10, $11, 'HIGH', $12, $13, $14
         FROM ml.app_prediction_runs pr WHERE pr.run_uid = $6::uuid
         ON CONFLICT (reservation_id) DO NOTHING
         RETURNING authorization_id::text AS authorization_id`,
        [
          authorization.reservationId,
          authorization.clinicId,
          authorization.appointmentAt,
          authorization.enabledAt,
          authorization.requestId,
          authorization.predictionRunId,
          authorization.predictionResultId,
          authorization.modelKey,
          authorization.modelVersion,
          authorization.researchPolicyHash,
          authorization.researchPolicyVersion,
          authorization.probabilityNoShowAtAuthorization,
          authorization.scoredAt,
          authorization.eligibilityRuleVersion,
        ],
      );
      const record = await this.findByReservation(authorization.reservationId);
      if (!record) throw new Error('Autorización no localizada tras INSERT');
      return { record, created: inserted.length === 1 };
    } catch (error) {
      throw toAppStoreException('SaveOverbookingAuthorization', error);
    }
  }

  async list(
    criteria: OperationalRecordListCriteria,
  ): Promise<OperationalRecordPage<OverbookingAuthorization>> {
    const params: SqlValue[] = [];
    try {
      const rows = await this.db.query<AuthorizationRow>(
        `SELECT ${COLUMNS} FROM ml.app_overbooking_authorizations a
         ${buildListClause('a', criteria, params)}`,
        params,
      );
      return toPage(rows.map(mapRow), criteria.limit);
    } catch (error) {
      throw toAppStoreException('ListOverbookingAuthorizations', error);
    }
  }
}
