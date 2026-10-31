import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { inImmediateTransaction } from '../../../../../infrastructure/database/sqlite/SqliteDatabase.js';
import type { ModelScore, NewModelScore } from '../../models/ModelScore.js';
import type { NewPredictionRun } from '../../models/PredictionRun.js';
import type {
  ModelIdentity,
  PredictionResultRepository,
  SavePredictionRunOutcome,
} from '../PredictionResultRepository.js';
import {
  iso,
  mapResultRow,
  RESULT_COLUMNS,
  toStoreException,
  type SqliteRow,
} from './SqliteRows.js';

const INSERT_RUN_SQL = `
INSERT INTO prediction_runs (
  run_uid, snapshot_id, reservation_id, mode, requested_model_keys_json, scoring_api_version,
  request_id, run_requested_at, completed_at, ml_latency_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING run_id`;

const INSERT_RESULT_SQL = `
INSERT INTO prediction_model_results (
  run_id, snapshot_id, reservation_id, model_key, algorithm, model_version, model_hash,
  model_hash_sha256, feature_version, prediction_at, scored_at, probability_no_show,
  prediction_target, validation_status, calibration_status, operational_use_allowed,
  risk_level, risk_policy_version, risk_policy_status, scoring_api_version, research_policy_key,
  experimental_level, experimental_label, experimental_status, experimental_policy_id,
  experimental_policy_version, experimental_policy_hash, experimental_low_upper_threshold,
  experimental_high_lower_threshold, experimental_boundary_rule, experimental_meaning,
  experimental_score_space, experimental_warnings_json, experimental_approved_by,
  experimental_operational_use_allowed
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
ON CONFLICT (snapshot_id, model_key, model_version, research_policy_key) DO NOTHING
RETURNING result_id`;

function resultValues(runId: number, reservationId: string, score: NewModelScore): SQLInputValue[] {
  const risk = score.experimentalRisk;
  return [
    runId,
    Number(score.snapshotId),
    reservationId,
    score.modelKey,
    score.algorithm,
    score.modelVersion,
    score.modelHash,
    score.modelHashSha256,
    score.featureVersion,
    iso(score.predictionAt),
    iso(score.scoredAt),
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
    risk ? 0 : null,
  ];
}

/** Señal interna para revertir una transacción sin resultados nuevos (sin run huérfano). */
class NothingInsertedSignal extends Error {}

/**
 * Runs y resultados inmutables en el almacén local. La transacción es corta y SÍNCRONA
 * (BEGIN IMMEDIATE … COMMIT dentro del mismo tick): nunca abarca la llamada a Python, y dos
 * peticiones del proceso no pueden intercalarse dentro de ella.
 */
export class SqlitePredictionResultRepository implements PredictionResultRepository {
  constructor(private readonly db: DatabaseSync) {}

  async findLatestBySnapshot(snapshotId: string): Promise<ModelScore[]> {
    try {
      return this.db
        .prepare(
          `SELECT ${RESULT_COLUMNS} FROM prediction_model_results r
           JOIN prediction_runs pr ON pr.run_id = r.run_id
           WHERE r.snapshot_id = ? AND r.result_id = (
             SELECT x.result_id FROM prediction_model_results x
             WHERE x.snapshot_id = r.snapshot_id AND x.model_key = r.model_key
             ORDER BY x.scored_at DESC, x.result_id DESC LIMIT 1)
           ORDER BY r.model_key`,
        )
        .all(Number(snapshotId))
        .map((row) => mapResultRow(row as SqliteRow));
    } catch (error) {
      throw toStoreException('FindLatestScores', error);
    }
  }

  async findByIdentities(
    snapshotId: string,
    identities: readonly ModelIdentity[],
  ): Promise<ModelScore[]> {
    if (identities.length === 0) return [];
    try {
      const statement = this.db.prepare(
        `SELECT ${RESULT_COLUMNS} FROM prediction_model_results r
         JOIN prediction_runs pr ON pr.run_id = r.run_id
         WHERE r.snapshot_id = ? AND r.model_key = ? AND r.model_version = ?
           AND r.research_policy_key = ?`,
      );
      return identities
        .flatMap((identity) =>
          statement.all(
            Number(snapshotId),
            identity.modelKey,
            identity.modelVersion,
            identity.researchPolicyHash ?? '',
          ),
        )
        .map((row) => mapResultRow(row as SqliteRow))
        .sort((left, right) => left.modelKey.localeCompare(right.modelKey));
    } catch (error) {
      throw toStoreException('FindScoresByIdentity', error);
    }
  }

  async saveRun(
    run: NewPredictionRun,
    scores: readonly NewModelScore[],
  ): Promise<SavePredictionRunOutcome> {
    let createdRunUid: string | null = null;
    try {
      inImmediateTransaction(this.db, () => {
        const created = this.db
          .prepare(INSERT_RUN_SQL)
          .get(
            run.runUid,
            Number(run.snapshotId),
            run.reservationId,
            run.mode,
            JSON.stringify(run.requestedModelKeys),
            run.scoringApiVersion,
            run.requestId,
            iso(run.runRequestedAt),
            iso(run.completedAt),
            Math.max(0, Math.round(run.mlLatencyMs)),
          );
        const runId = Number(created?.run_id);
        const insertResult = this.db.prepare(INSERT_RESULT_SQL);
        const inserted = scores.filter(
          (score) =>
            insertResult.get(...resultValues(runId, run.reservationId, score)) !== undefined,
        ).length;
        // Todo ya existía (petición concurrente idéntica): no dejar un run sin resultados.
        if (inserted === 0) throw new NothingInsertedSignal();
        createdRunUid = run.runUid;
      });
    } catch (error) {
      if (!(error instanceof NothingInsertedSignal))
        throw toStoreException('SavePredictionRun', error);
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
}
