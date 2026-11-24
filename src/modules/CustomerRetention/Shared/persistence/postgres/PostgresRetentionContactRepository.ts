import {
  toAppStoreException,
  type AppStoreQueryable,
} from '../../../../../infrastructure/database/postgres/PredictiveAppDatabase.js';
import type { MlModelKey } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type {
  NewRetentionContact,
  RetentionContact,
  RetentionContactSummary,
} from '../../models/RetentionContact.js';
import type {
  RetentionContactInsertOutcome,
  RetentionContactRepository,
} from '../RetentionContactRepository.js';

interface ContactRow {
  contact_id: string;
  reservation_id: string;
  client_id: string;
  clinic_id: number;
  appointment_at: Date;
  retention_status: 'CAMPAIGN_SENT';
  contacted_at: Date;
  request_id: string;
  prediction_run_uid: string;
  prediction_result_id: string;
  model_key: MlModelKey;
  model_version: string;
  research_policy_hash: string;
  research_policy_version: string;
  risk_band_at_contact: 'HIGH';
  probability_no_show_at_contact: number;
  scored_at: Date;
  eligibility_rule_version: string;
}

const COLUMNS = `
  c.contact_id::text AS contact_id, c.reservation_id::text AS reservation_id,
  c.client_id::text AS client_id, c.clinic_id, c.appointment_at, c.retention_status,
  c.contacted_at, c.request_id, c.prediction_run_uid::text AS prediction_run_uid,
  c.prediction_result_id::text AS prediction_result_id, c.model_key, c.model_version,
  c.research_policy_hash, c.research_policy_version, c.risk_band_at_contact,
  c.probability_no_show_at_contact, c.scored_at, c.eligibility_rule_version`;

function mapRow(row: ContactRow): RetentionContact {
  return {
    contactId: row.contact_id,
    reservationId: row.reservation_id,
    clientId: row.client_id,
    clinicId: Number(row.clinic_id),
    appointmentAt: row.appointment_at,
    retentionStatus: row.retention_status,
    contactedAt: row.contacted_at,
    requestId: row.request_id,
    actorKind: 'INTERNAL_SERVICE',
    actorUserId: null,
    predictionRunId: row.prediction_run_uid,
    predictionResultId: row.prediction_result_id,
    modelKey: row.model_key,
    modelVersion: row.model_version,
    researchPolicyHash: row.research_policy_hash,
    researchPolicyVersion: row.research_policy_version,
    riskBandAtContact: row.risk_band_at_contact,
    probabilityNoShowAtContact: Number(row.probability_no_show_at_contact),
    scoredAt: row.scored_at,
    eligibilityRuleVersion: row.eligibility_rule_version,
  };
}

/**
 * Contactos de retención sobre ml.app_retention_contacts: solo SELECT/INSERT. UNIQUE
 * (reservation_id) + ON CONFLICT DO NOTHING hacen el registro idempotente y seguro ante
 * peticiones concurrentes; las FK compuestas atan el contacto a una predicción de ESA reserva.
 */
export class PostgresRetentionContactRepository implements RetentionContactRepository {
  constructor(private readonly db: AppStoreQueryable) {}

  async findByReservation(reservationId: DecimalId): Promise<RetentionContact | null> {
    try {
      const [row] = await this.db.query<ContactRow>(
        `SELECT ${COLUMNS} FROM ml.app_retention_contacts c WHERE c.reservation_id = $1::bigint`,
        [reservationId],
      );
      return row ? mapRow(row) : null;
    } catch (error) {
      throw toAppStoreException('FindRetentionContact', error);
    }
  }

  async insertIfAbsent(contact: NewRetentionContact): Promise<RetentionContactInsertOutcome> {
    try {
      const inserted = await this.db.query<{ contact_id: string }>(
        `INSERT INTO ml.app_retention_contacts (
           reservation_id, client_id, clinic_id, appointment_at, retention_status, contacted_at,
           request_id, actor_kind, actor_user_id, prediction_run_id, prediction_run_uid,
           prediction_result_id, model_key, model_version, research_policy_hash,
           research_policy_version, risk_band_at_contact, probability_no_show_at_contact,
           scored_at, eligibility_rule_version
         )
         SELECT $1::bigint, $2::bigint, $3::integer, $4, 'CAMPAIGN_SENT', $5, $6,
                'INTERNAL_SERVICE', NULL, pr.run_id, pr.run_uid, $8::bigint, $9, $10, $11, $12,
                'HIGH', $13, $14, $15
         FROM ml.app_prediction_runs pr WHERE pr.run_uid = $7::uuid
         ON CONFLICT (reservation_id) DO NOTHING
         RETURNING contact_id::text AS contact_id`,
        [
          contact.reservationId,
          contact.clientId,
          contact.clinicId,
          contact.appointmentAt,
          contact.contactedAt,
          contact.requestId,
          contact.predictionRunId,
          contact.predictionResultId,
          contact.modelKey,
          contact.modelVersion,
          contact.researchPolicyHash,
          contact.researchPolicyVersion,
          contact.probabilityNoShowAtContact,
          contact.scoredAt,
          contact.eligibilityRuleVersion,
        ],
      );
      const record = await this.findByReservation(contact.reservationId);
      if (!record) throw new Error('Contacto de retención no localizado tras INSERT');
      return { record, created: inserted.length === 1 };
    } catch (error) {
      throw toAppStoreException('SaveRetentionContact', error);
    }
  }

  async contactsFor(
    reservationIds: readonly DecimalId[],
  ): Promise<ReadonlyMap<DecimalId, RetentionContactSummary>> {
    if (reservationIds.length === 0) return new Map();
    try {
      const rows = await this.db.query<{
        reservation_id: string;
        contact_id: string;
        contacted_at: Date;
        model_key: MlModelKey;
        prediction_run_uid: string;
      }>(
        `SELECT c.reservation_id::text AS reservation_id, c.contact_id::text AS contact_id,
                c.contacted_at, c.model_key, c.prediction_run_uid::text AS prediction_run_uid
         FROM ml.app_retention_contacts c WHERE c.reservation_id = ANY($1::bigint[])`,
        [[...new Set(reservationIds)]],
      );
      return new Map(
        rows.map((row) => [
          row.reservation_id,
          {
            contactId: row.contact_id,
            contactedAt: row.contacted_at,
            modelKey: row.model_key,
            predictionRunId: row.prediction_run_uid,
          },
        ]),
      );
    } catch (error) {
      throw toAppStoreException('ReadRetentionContacts', error);
    }
  }
}
