import {
  toAppStoreException,
  type AppStoreDatabase,
  type SqlValue,
} from '../../../../../infrastructure/database/postgres/PredictiveAppDatabase.js';
import type { SnapshotEvidenceSource } from '../../../../../shared/data/DataSourceMode.js';
import type { ModelScore, NewModelScore } from '../../models/ModelScore.js';
import type { NewPredictionRun } from '../../models/PredictionRun.js';
import type {
  ModelIdentity,
  PredictionResultRepository,
  SavePredictionRunOutcome,
} from '../PredictionResultRepository.js';
import type { PredictionRunReader } from '../PredictionRunReader.js';
import { mapResultRow, RESULT_COLUMNS, type PgRow } from './PostgresRows.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INSERT_RUN_SQL = `
INSERT INTO ml.app_prediction_runs (
  run_uid, snapshot_id, reservation_id, mode, requested_model_keys, scoring_api_version,
  request_id, run_requested_at, completed_at, ml_latency_ms
) VALUES ($1::uuid, $2::bigint, $3::bigint, $4, $5::text[], $6, $7, $8, $9, $10)
RETURNING run_id::text AS run_id`;

const INSERT_RESULT_SQL = `
INSERT INTO ml.app_prediction_model_results (
  run_id, snapshot_id, reservation_id, model_key, algorithm, model_version, model_hash,
  model_hash_sha256, feature_version, prediction_at, scored_at, probability_no_show,
  prediction_target, validation_status, calibration_status, operational_use_allowed,
  risk_level, risk_policy_version, risk_policy_status, scoring_api_version, research_policy_key,
  experimental_level, experimental_label, experimental_status, experimental_policy_id,
  experimental_policy_version, experimental_policy_hash, experimental_low_upper_threshold,
  experimental_high_lower_threshold, experimental_boundary_rule, experimental_meaning,
  experimental_score_space, experimental_warnings, experimental_approved_by,
  experimental_operational_use_allowed
) VALUES ($1::bigint, $2::bigint, $3::bigint, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          $15, false, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
          $31, $32::jsonb, NULL, $33)
ON CONFLICT (snapshot_id, model_key, model_version, research_policy_key) DO NOTHING
RETURNING result_id`;

function resultValues(runId: string, reservationId: string, score: NewModelScore): SqlValue[] {
  const risk = score.experimentalRisk;
  return [
    runId,
    score.snapshotId,
    reservationId,
    score.modelKey,
    score.algorithm,
    score.modelVersion,
    score.modelHash,
    score.modelHashSha256,
    score.featureVersion,
    score.predictionAt,
    score.scoredAt,
    score.probabilityNoShow,
    score.predictionTarget,
    score.validationStatus,
    score.calibrationStatus,
    score.riskLevel,
    score.riskPolicyVersion,
    score.riskPolicyStatus,
    score.scoringApiVersion,
    risk?.policyHash ?? '',
    risk?.level ?? null,
    risk?.label ?? null,
    risk?.status ?? null,
    risk?.policyId ?? null,
    risk?.policyVersion ?? null,
    risk?.policyHash ?? null,
    risk?.lowUpperThreshold ?? null,
    risk?.highLowerThreshold ?? null,
    risk?.boundaryRule ?? null,
    risk?.meaning ?? null,
    risk?.scoreSpace ?? null,
    risk ? JSON.stringify(risk.warnings) : null,
    risk ? false : null,
  ];
}

/** Señal interna para revertir una transacción sin resultados nuevos (sin run huérfano). */
class NothingInsertedSignal extends Error {}

/**
 * Runs y resultados inmutables en ml.app_*. La transacción es corta (BEGIN … COMMIT en una sola
 * conexión) y se abre DESPUÉS de validar la respuesta de Python: nunca abarca la inferencia.
 * Concurrencia: UNIQUE + ON CONFLICT DO NOTHING; el perdedor lee al ganador.
 */
export class PostgresPredictionResultRepository
  implements PredictionResultRepository, PredictionRunReader
{
  constructor(private readonly db: AppStoreDatabase) {}

  async findLatestBySnapshot(snapshotId: string): Promise<ModelScore[]> {
    try {
      const rows = await this.db.query<PgRow>(
        `SELECT DISTINCT ON (r.model_key) ${RESULT_COLUMNS}
         FROM ml.app_prediction_model_results r
         JOIN ml.app_prediction_runs pr ON pr.run_id = r.run_id
         WHERE r.snapshot_id = $1::bigint
         ORDER BY r.model_key, r.scored_at DESC, r.result_id DESC`,
        [snapshotId],
      );
      return rows.map(mapResultRow);
    } catch (error) {
      throw toAppStoreException('FindLatestScores', error);
    }
  }

  async findByIdentities(
    snapshotId: string,
    identities: readonly ModelIdentity[],
  ): Promise<ModelScore[]> {
    if (identities.length === 0) return [];
    try {
      const rows = await this.db.query<PgRow>(
        `SELECT ${RESULT_COLUMNS}
         FROM ml.app_prediction_model_results r
         JOIN ml.app_prediction_runs pr ON pr.run_id = r.run_id
         JOIN unnest($2::text[], $3::text[], $4::text[]) AS i(model_key, model_version, policy_key)
           ON i.model_key = r.model_key AND i.model_version = r.model_version
          AND i.policy_key = r.research_policy_key
         WHERE r.snapshot_id = $1::bigint
         ORDER BY r.model_key`,
        [
          snapshotId,
          identities.map((identity) => identity.modelKey),
          identities.map((identity) => identity.modelVersion),
          identities.map((identity) => identity.researchPolicyHash ?? ''),
        ],
      );
      return rows.map(mapResultRow);
    } catch (error) {
      throw toAppStoreException('FindScoresByIdentity', error);
    }
  }

  async saveRun(
    run: NewPredictionRun,
    scores: readonly NewModelScore[],
  ): Promise<SavePredictionRunOutcome> {
    let createdRunUid: string | null = null;
    try {
      await this.db.transaction(async (tx) => {
        const [created] = await tx.query<{ run_id: string }>(INSERT_RUN_SQL, [
          run.runUid,
          run.snapshotId,
          run.reservationId,
          run.mode,
          [...run.requestedModelKeys],
          run.scoringApiVersion,
          run.requestId,
          run.runRequestedAt,
          run.completedAt,
          Math.max(0, Math.round(run.mlLatencyMs)),
        ]);
        if (!created) throw new Error('Run no creado');
        let inserted = 0;
        for (const score of scores) {
          const rows = await tx.query(
            INSERT_RESULT_SQL,
            resultValues(created.run_id, run.reservationId, score),
          );
          inserted += rows.length;
        }
        // Todo ya existía (petición concurrente idéntica): no dejar un run sin resultados.
        if (inserted === 0) throw new NothingInsertedSignal();
        createdRunUid = run.runUid;
      });
    } catch (error) {
      if (!(error instanceof NothingInsertedSignal)) {
        throw toAppStoreException('SavePredictionRun', error);
      }
    }

    const snapshotId = scores[0]?.snapshotId;
    const winners = snapshotId
      ? await this.findByIdentities(
          snapshotId,
          scores.map((score) => ({
            modelKey: score.modelKey,
            modelVersion: score.modelVersion,
            researchPolicyHash: score.experimentalRisk?.policyHash ?? null,
          })),
        )
      : [];
    return { createdRunUid, scores: winners };
  }

  async findRunResults(
    reservationId: string,
    predictionRunId: string,
    evidence: SnapshotEvidenceSource,
  ): Promise<readonly ModelScore[]> {
    if (!UUID.test(predictionRunId)) return [];
    try {
      const rows = await this.db.query<PgRow>(
        `SELECT ${RESULT_COLUMNS}
         FROM ml.app_prediction_model_results r
         JOIN ml.app_prediction_runs pr ON pr.run_id = r.run_id
         JOIN ml.app_booking_feature_snapshots s ON s.snapshot_id = r.snapshot_id
         WHERE pr.run_uid = $1::uuid AND r.reservation_id = $2::bigint
           AND s.evidence_source = $3
         ORDER BY r.model_key`,
        [predictionRunId, reservationId, evidence],
      );
      return rows.map(mapResultRow);
    } catch (error) {
      throw toAppStoreException('FindRunResults', error);
    }
  }
}
