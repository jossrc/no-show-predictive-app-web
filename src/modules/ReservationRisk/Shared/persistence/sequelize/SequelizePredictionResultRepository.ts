import { QueryTypes, Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import type { MlModelKey } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { RiskLevel } from '../../policy/RiskLevelPolicy.js';
import type { ModelScore, NewModelScore } from '../../models/ModelScore.js';
import type { NewPredictionRun } from '../../models/PredictionRun.js';
import type {
  ModelIdentity,
  PredictionResultRepository,
  SavePredictionRunOutcome,
} from '../PredictionResultRepository.js';
import { PersistenceUnavailableException } from '../../../../../infrastructure/database/errors/PersistenceUnavailableException.js';
import { toPersistenceException } from './PredictiveStoreErrors.js';

const RESULT_COLUMNS = `
  r.result_id::text AS result_id, pr.run_uid::text AS run_uid, r.snapshot_id::text AS snapshot_id,
  r.model_key, r.algorithm, r.model_version, r.model_hash, r.feature_version, r.prediction_at,
  r.scored_at, r.probability_no_show, r.prediction_target, r.validation_status,
  r.calibration_status, r.operational_use_allowed, r.risk_level, r.risk_policy_version,
  r.risk_policy_status`;

const LATEST_BY_SNAPSHOT_SQL = `
SELECT DISTINCT ON (r.model_key) ${RESULT_COLUMNS}
FROM ml.prediction_model_results r
JOIN ml.prediction_runs pr ON pr.run_id = r.run_id
WHERE r.snapshot_id = $1::bigint
ORDER BY r.model_key, r.scored_at DESC, r.result_id DESC`;

const BY_IDENTITIES_SQL = `
SELECT ${RESULT_COLUMNS}
FROM ml.prediction_model_results r
JOIN ml.prediction_runs pr ON pr.run_id = r.run_id
JOIN unnest($2::text[], $3::text[]) AS wanted(model_key, model_version)
  ON wanted.model_key = r.model_key AND wanted.model_version = r.model_version
WHERE r.snapshot_id = $1::bigint
ORDER BY r.model_key`;

const INSERT_RUN_SQL = `
INSERT INTO ml.prediction_runs (
  run_uid, snapshot_id, reservation_id, mode, requested_model_keys, request_id,
  run_requested_at, completed_at, ml_latency_ms
) VALUES ($1::uuid, $2::bigint, $3::bigint, $4, $5::text[], $6, $7::timestamptz, $8::timestamptz, $9)
RETURNING run_id::text AS run_id`;

const INSERT_RESULT_SQL = `
INSERT INTO ml.prediction_model_results (
  run_id, snapshot_id, reservation_id, model_key, algorithm, model_version, model_hash,
  feature_version, prediction_at, scored_at, probability_no_show, prediction_target,
  validation_status, calibration_status, operational_use_allowed, risk_level,
  risk_policy_version, risk_policy_status
) VALUES (
  $1::bigint, $2::bigint, $3::bigint, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz,
  $11::double precision, $12, $13, $14, false, $15, $16, $17
)
ON CONFLICT (snapshot_id, model_key, model_version) DO NOTHING
RETURNING result_id::text AS result_id`;

interface ResultRow {
  result_id: string;
  run_uid: string;
  snapshot_id: string;
  model_key: MlModelKey;
  algorithm: 'random_forest' | 'xgboost';
  model_version: string;
  model_hash: string;
  feature_version: string;
  prediction_at: Date;
  scored_at: Date;
  probability_no_show: number;
  prediction_target: 'NO_SHOW_CANDIDATE';
  validation_status: string;
  calibration_status: string;
  operational_use_allowed: boolean;
  risk_level: RiskLevel | null;
  risk_policy_version: string | null;
  risk_policy_status: string;
}

/** Señal interna para revertir una transacción sin resultados nuevos (sin run huérfano). */
class NothingInsertedSignal extends Error {}

function mapRow(row: ResultRow): ModelScore {
  if (row.operational_use_allowed !== false) {
    // CHECK en BD lo impide; se verifica de nuevo para no propagar un estado operativo falso.
    throw new Error('Resultado persistido con uso operativo habilitado');
  }

  return {
    resultId: row.result_id,
    predictionRunId: row.run_uid,
    snapshotId: row.snapshot_id,
    modelKey: row.model_key,
    algorithm: row.algorithm,
    modelVersion: row.model_version,
    modelHash: row.model_hash,
    featureVersion: row.feature_version,
    predictionAt: row.prediction_at,
    scoredAt: row.scored_at,
    probabilityNoShow: Number(row.probability_no_show),
    predictionTarget: row.prediction_target,
    validationStatus: row.validation_status,
    calibrationStatus: row.calibration_status,
    operationalUseAllowed: false,
    riskLevel: row.risk_level,
    riskPolicyVersion: row.risk_policy_version,
    riskPolicyStatus: row.risk_policy_status,
    // La migración 001 del schema ml no tiene columnas de la política research v2.
    scoringApiVersion: 'v1',
    modelHashSha256: null,
    experimentalRisk: null,
  };
}

/**
 * Adaptador PostgreSQL del schema `ml` (migración 001). PRESERVADO Y AISLADO: el runtime actual
 * usa el almacén SQLite local porque PostgreSQL es fuente de solo lectura (ADR-006); este
 * adaptador solo se conectaría con autorización expresa de escritura y una conexión separada.
 * Su esquema no admite la banda experimental v2: guardar un score v2 falla cerrado en lugar
 * de perder la clasificación.
 */
export class SequelizePredictionResultRepository implements PredictionResultRepository {
  constructor(private readonly sequelize: Sequelize) {}

  async findLatestBySnapshot(snapshotId: string): Promise<ModelScore[]> {
    try {
      const rows = await this.sequelize.query<ResultRow>(LATEST_BY_SNAPSHOT_SQL, {
        bind: [snapshotId],
        type: QueryTypes.SELECT,
      });
      return rows.map(mapRow);
    } catch (error) {
      throw toPersistenceException('FindLatestScores', error);
    }
  }

  async findByIdentities(
    snapshotId: string,
    identities: readonly ModelIdentity[],
  ): Promise<ModelScore[]> {
    // Este esquema solo contiene scores v1 (sin política research).
    const v1Identities = identities.filter((identity) => identity.researchPolicyHash === null);
    if (v1Identities.length === 0) return [];

    try {
      const rows = await this.sequelize.query<ResultRow>(BY_IDENTITIES_SQL, {
        bind: [
          snapshotId,
          v1Identities.map((identity) => identity.modelKey),
          v1Identities.map((identity) => identity.modelVersion),
        ],
        type: QueryTypes.SELECT,
      });
      return rows.map(mapRow);
    } catch (error) {
      throw toPersistenceException('FindScoresByIdentity', error);
    }
  }

  async saveRun(
    run: NewPredictionRun,
    scores: readonly NewModelScore[],
  ): Promise<SavePredictionRunOutcome> {
    if (scores.some((score) => score.experimentalRisk !== null)) {
      throw new PersistenceUnavailableException({
        operation: 'SavePredictionRun',
        reason: 'EXPERIMENTAL_RISK_NOT_SUPPORTED',
      });
    }
    let createdRunUid: string | null = null;

    try {
      await this.sequelize.transaction(
        { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED },
        async (transaction) => {
          const [created] = await this.sequelize.query<{ run_id: string }>(INSERT_RUN_SQL, {
            bind: [
              run.runUid,
              run.snapshotId,
              run.reservationId,
              run.mode,
              [...run.requestedModelKeys],
              run.requestId,
              run.runRequestedAt,
              run.completedAt,
              Math.round(run.mlLatencyMs),
            ],
            type: QueryTypes.SELECT,
            transaction,
          });
          if (!created) throw new Error('No se pudo registrar el run de predicción');

          let inserted = 0;
          for (const score of scores) {
            const rows = await this.sequelize.query<{ result_id: string }>(INSERT_RESULT_SQL, {
              bind: [
                created.run_id,
                score.snapshotId,
                run.reservationId,
                score.modelKey,
                score.algorithm,
                score.modelVersion,
                score.modelHash,
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
              ],
              type: QueryTypes.SELECT,
              transaction,
            });
            inserted += rows.length;
          }

          // Todo ya existía (petición concurrente idéntica): no dejar un run sin resultados.
          if (inserted === 0) throw new NothingInsertedSignal();
          createdRunUid = run.runUid;
        },
      );
    } catch (error) {
      if (!(error instanceof NothingInsertedSignal)) {
        throw toPersistenceException('SavePredictionRun', error);
      }
    }

    const snapshotId = scores[0]?.snapshotId;
    const winners = snapshotId
      ? await this.findByIdentities(
          snapshotId,
          scores.map((score) => ({
            modelKey: score.modelKey,
            modelVersion: score.modelVersion,
            researchPolicyHash: null,
          })),
        )
      : [];

    return { createdRunUid, scores: winners };
  }
}
