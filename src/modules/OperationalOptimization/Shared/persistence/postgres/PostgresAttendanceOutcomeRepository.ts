import {
  toAppStoreException,
  type AppStoreDatabase,
  type SqlValue,
} from '../../../../../infrastructure/database/postgres/PredictiveAppDatabase.js';
import type { MlModelKey } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { ExperimentalRiskLevel } from '../../../../Reservations/Shared/models/ReservationScoreSummary.js';
import type {
  AttendanceComparison,
  AttendanceOutcome,
  AttendanceStatus,
  NewAttendanceOutcome,
} from '../../models/OperationalRecords.js';
import type { AttendanceOutcomeRepository } from '../AttendanceOutcomeRepository.js';
import type {
  InsertOutcome,
  OperationalRecordListCriteria,
  OperationalRecordPage,
} from '../OperationalRecordListCriteria.js';
import { buildListClause, toPage } from './OperationalListSql.js';

interface OutcomeRow {
  attendance_outcome_id: string;
  reservation_id: string;
  clinic_id: number;
  appointment_at: Date;
  appointment_end_at: Date | null;
  source_reservation_status: 'SCHEDULED' | 'PAST';
  attendance_status: AttendanceStatus;
  observed_no_show: boolean;
  recorded_at: Date;
  request_id: string;
  prediction_run_uid: string;
  finished_rule_version: string;
}

interface ComparisonRow {
  attendance_outcome_id: string;
  prediction_result_id: string;
  model_key: MlModelKey;
  model_version: string;
  probability_no_show: number;
  scored_at: Date;
  experimental_risk_level: ExperimentalRiskLevel | null;
  research_policy_hash: string | null;
  comparison_rule_version: string;
  threshold: number;
  predicted_no_show: boolean;
  observed_no_show: boolean;
  matches_prediction: boolean;
}

const OUTCOME_COLUMNS = `
  o.attendance_outcome_id::text AS attendance_outcome_id, o.reservation_id::text AS reservation_id,
  o.clinic_id, o.appointment_at, o.appointment_end_at, o.source_reservation_status,
  o.attendance_status, o.observed_no_show, o.recorded_at, o.request_id,
  o.prediction_run_uid::text AS prediction_run_uid, o.finished_rule_version`;

const COMPARISON_COLUMNS = `
  c.attendance_outcome_id::text AS attendance_outcome_id,
  c.prediction_result_id::text AS prediction_result_id, c.model_key, c.model_version,
  c.probability_no_show, c.scored_at, c.experimental_risk_level, c.research_policy_hash,
  c.comparison_rule_version, c.threshold, c.predicted_no_show, c.observed_no_show,
  c.matches_prediction`;

function mapComparison(row: ComparisonRow): AttendanceComparison {
  return {
    predictionResultId: row.prediction_result_id,
    modelKey: row.model_key,
    modelVersion: row.model_version,
    probabilityNoShow: Number(row.probability_no_show),
    scoredAt: row.scored_at,
    experimentalRiskLevel: row.experimental_risk_level,
    researchPolicyHash: row.research_policy_hash,
    comparisonRuleVersion: row.comparison_rule_version,
    threshold: Number(row.threshold),
    predictedNoShow: row.predicted_no_show,
    observedNoShow: row.observed_no_show,
    matchesPrediction: row.matches_prediction,
  };
}

function mapOutcome(row: OutcomeRow, comparisons: AttendanceComparison[]): AttendanceOutcome {
  return {
    attendanceOutcomeId: row.attendance_outcome_id,
    reservationId: row.reservation_id,
    clinicId: Number(row.clinic_id),
    appointmentAt: row.appointment_at,
    appointmentEndAt: row.appointment_end_at,
    sourceReservationStatus: row.source_reservation_status,
    attendanceStatus: row.attendance_status,
    observedNoShow: row.observed_no_show,
    recordedAt: row.recorded_at,
    requestId: row.request_id,
    actorKind: 'INTERNAL_SERVICE',
    actorUserId: null,
    predictionRunId: row.prediction_run_uid,
    finishedRuleVersion: row.finished_rule_version,
    comparisons,
  };
}

/**
 * HU-07 sobre ml.app_attendance_outcomes + ml.app_attendance_prediction_comparisons. La
 * observación y sus comparaciones se insertan en UNA transacción corta; comparaciones de una
 * página se leen con una sola consulta (sin N+1).
 */
export class PostgresAttendanceOutcomeRepository implements AttendanceOutcomeRepository {
  constructor(private readonly db: AppStoreDatabase) {}

  async findByReservation(reservationId: string): Promise<AttendanceOutcome | null> {
    try {
      const rows = await this.db.query<OutcomeRow>(
        `SELECT ${OUTCOME_COLUMNS} FROM ml.app_attendance_outcomes o
         WHERE o.reservation_id = $1::bigint`,
        [reservationId],
      );
      return (await this.withComparisons(rows))[0] ?? null;
    } catch (error) {
      throw toAppStoreException('FindAttendanceOutcome', error);
    }
  }

  async insertIfAbsent(outcome: NewAttendanceOutcome): Promise<InsertOutcome<AttendanceOutcome>> {
    try {
      const created = await this.db.transaction(async (tx) => {
        const [inserted] = await tx.query<{ attendance_outcome_id: string; run_id: string }>(
          `INSERT INTO ml.app_attendance_outcomes (
             reservation_id, clinic_id, appointment_at, appointment_end_at,
             source_reservation_status, attendance_status, observed_no_show, recorded_at,
             request_id, actor_kind, actor_user_id, prediction_run_id, prediction_run_uid,
             finished_rule_version
           )
           SELECT $1::bigint, $2::integer, $3, $4, $5, $6, $7, $8, $9, 'INTERNAL_SERVICE', NULL,
                  pr.run_id, pr.run_uid, $11
           FROM ml.app_prediction_runs pr WHERE pr.run_uid = $10::uuid
           ON CONFLICT (reservation_id) DO NOTHING
           RETURNING attendance_outcome_id::text AS attendance_outcome_id,
                     prediction_run_id::text AS run_id`,
          [
            outcome.reservationId,
            outcome.clinicId,
            outcome.appointmentAt,
            outcome.appointmentEndAt,
            outcome.sourceReservationStatus,
            outcome.attendanceStatus,
            outcome.observedNoShow,
            outcome.recordedAt,
            outcome.requestId,
            outcome.predictionRunId,
            outcome.finishedRuleVersion,
          ],
        );
        if (!inserted) return false;
        for (const comparison of outcome.comparisons) {
          await tx.query(
            `INSERT INTO ml.app_attendance_prediction_comparisons (
               attendance_outcome_id, reservation_id, prediction_run_id, prediction_result_id,
               model_key, model_version, probability_no_show, scored_at, experimental_risk_level,
               research_policy_hash, comparison_rule_version, threshold, predicted_no_show,
               observed_no_show, matches_prediction
             ) VALUES ($1::bigint, $2::bigint, $3::bigint, $4::bigint, $5, $6, $7, $8, $9, $10,
                       $11, $12, $13, $14, $15)`,
            [
              inserted.attendance_outcome_id,
              outcome.reservationId,
              inserted.run_id,
              comparison.predictionResultId,
              comparison.modelKey,
              comparison.modelVersion,
              comparison.probabilityNoShow,
              comparison.scoredAt,
              comparison.experimentalRiskLevel,
              comparison.researchPolicyHash,
              comparison.comparisonRuleVersion,
              comparison.threshold,
              comparison.predictedNoShow,
              comparison.observedNoShow,
              comparison.matchesPrediction,
            ],
          );
        }
        return true;
      });
      const record = await this.findByReservation(outcome.reservationId);
      if (!record) throw new Error('Resultado de asistencia no localizado tras INSERT');
      return { record, created };
    } catch (error) {
      throw toAppStoreException('SaveAttendanceOutcome', error);
    }
  }

  async list(
    criteria: OperationalRecordListCriteria,
  ): Promise<OperationalRecordPage<AttendanceOutcome>> {
    const params: SqlValue[] = [];
    try {
      const rows = await this.db.query<OutcomeRow>(
        `SELECT ${OUTCOME_COLUMNS} FROM ml.app_attendance_outcomes o
         ${buildListClause('o', criteria, params)}`,
        params,
      );
      const page = toPage(rows, criteria.limit);
      return { rows: await this.withComparisons(page.rows), hasMore: page.hasMore };
    } catch (error) {
      throw toAppStoreException('ListAttendanceOutcomes', error);
    }
  }

  private async withComparisons(rows: readonly OutcomeRow[]): Promise<AttendanceOutcome[]> {
    if (rows.length === 0) return [];
    const comparisons = await this.db.query<ComparisonRow>(
      `SELECT ${COMPARISON_COLUMNS} FROM ml.app_attendance_prediction_comparisons c
       WHERE c.attendance_outcome_id = ANY($1::bigint[])
       ORDER BY c.attendance_outcome_id, c.model_key`,
      [rows.map((row) => row.attendance_outcome_id)],
    );
    return rows.map((row) =>
      mapOutcome(
        row,
        comparisons
          .filter((comparison) => comparison.attendance_outcome_id === row.attendance_outcome_id)
          .map(mapComparison),
      ),
    );
  }
}
