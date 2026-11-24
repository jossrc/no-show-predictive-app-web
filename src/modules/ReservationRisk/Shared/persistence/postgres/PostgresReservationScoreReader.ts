import {
  toAppStoreException,
  type AppStoreQueryable,
  type SqlValue,
} from '../../../../../infrastructure/database/postgres/PredictiveAppDatabase.js';
import type { MlModelKey } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { SnapshotEvidenceSource } from '../../../../../shared/data/DataSourceMode.js';
import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { ReservationScoreSummary } from '../../../../Reservations/Shared/models/ReservationScoreSummary.js';
import type {
  ExperimentalPolicyIdentity,
  RankedScore,
  ReservationScoreReader,
  ScoreRankingCriteria,
} from '../../../../Reservations/Shared/persistence/ReservationScoreReader.js';
import { summarizeExperimentalRisk } from '../../models/ExperimentalRisk.js';
import { mapResultRow, RESULT_COLUMNS, type PgRow } from './PostgresRows.js';

/**
 * Último resultado por (reserva, modelo) entre snapshots con la evidencia del modo activo.
 * Desempate idéntico al detalle: scored_at DESC, result_id DESC. `%SCOPE%` es un fragmento fijo
 * del código (nunca entrada de usuario); los valores viajan siempre como parámetros.
 */
const LATEST_CTE = `
WITH latest AS (
  SELECT r.reservation_id::text AS latest_reservation_id, ${RESULT_COLUMNS},
         r.research_policy_key,
         ROW_NUMBER() OVER (
           PARTITION BY r.reservation_id, r.model_key
           ORDER BY r.scored_at DESC, r.result_id DESC
         ) AS position
  FROM ml.app_prediction_model_results r
  JOIN ml.app_booking_feature_snapshots s
    ON s.snapshot_id = r.snapshot_id AND s.evidence_source = $1
  JOIN ml.app_prediction_runs pr ON pr.run_id = r.run_id
  WHERE %SCOPE%
)`;

function latestQuery(scope: string, select: string): string {
  return `${LATEST_CTE.replace('%SCOPE%', scope)}\n${select}`;
}

/** Lectura de scores del almacén PostgreSQL de la app para listado/detalle (sin N+1). */
export class PostgresReservationScoreReader implements ReservationScoreReader {
  constructor(private readonly db: AppStoreQueryable) {}

  async isAvailable(): Promise<boolean> {
    try {
      const [row] = await this.db.query<{ ok: number }>('SELECT 1 AS ok');
      return row?.ok === 1;
    } catch {
      return false;
    }
  }

  async latestScores(
    reservationIds: readonly DecimalId[],
    evidence: SnapshotEvidenceSource,
  ): Promise<ReadonlyMap<DecimalId, readonly ReservationScoreSummary[]>> {
    const byReservation = new Map<DecimalId, ReservationScoreSummary[]>();
    if (reservationIds.length === 0) return byReservation;
    try {
      const rows = await this.db.query<PgRow>(
        latestQuery(
          'r.reservation_id = ANY($2::bigint[])',
          `SELECT * FROM latest WHERE position = 1 ORDER BY latest_reservation_id, model_key`,
        ),
        [evidence, [...reservationIds]],
      );
      for (const row of rows) {
        const score = mapResultRow(row);
        const reservationId = String(row.latest_reservation_id);
        const list = byReservation.get(reservationId) ?? [];
        list.push({
          modelKey: score.modelKey,
          modelVersion: score.modelVersion,
          modelHash: score.modelHash,
          probabilityNoShow: score.probabilityNoShow,
          scoredAt: score.scoredAt,
          predictionRunId: score.predictionRunId,
          experimentalRisk: score.experimentalRisk
            ? summarizeExperimentalRisk(score.experimentalRisk)
            : null,
        });
        byReservation.set(reservationId, list);
      }
      return byReservation;
    } catch (error) {
      throw toAppStoreException('ListLatestScores', error);
    }
  }

  async reservationsWithUsableSnapshot(
    reservationIds: readonly DecimalId[],
    evidence: SnapshotEvidenceSource,
  ): Promise<ReadonlySet<DecimalId>> {
    if (reservationIds.length === 0) return new Set();
    try {
      const rows = await this.db.query<{ reservation_id: string }>(
        `SELECT DISTINCT reservation_id::text AS reservation_id
         FROM ml.app_booking_feature_snapshots
         WHERE evidence_source = $1 AND reservation_id = ANY($2::bigint[])`,
        [evidence, [...reservationIds]],
      );
      return new Set(rows.map((row) => row.reservation_id));
    } catch (error) {
      throw toAppStoreException('ListUsableSnapshots', error);
    }
  }

  async rankLatest(criteria: ScoreRankingCriteria): Promise<readonly RankedScore[]> {
    const conditions = ['position = 1'];
    const params: SqlValue[] = [criteria.evidence, criteria.modelKey];
    const next = (value: SqlValue): string => {
      params.push(value);
      return `$${params.length}`;
    };
    if (criteria.probabilityRange) {
      conditions.push(
        `probability_no_show >= ${next(criteria.probabilityRange.minInclusive)}`,
        `probability_no_show < ${next(criteria.probabilityRange.maxExclusive)}`,
      );
    }
    if (criteria.experimentalPolicyHash !== null) {
      conditions.push(`research_policy_key = ${next(criteria.experimentalPolicyHash)}`);
    }
    if (criteria.experimentalRiskLevel !== null) {
      conditions.push(`experimental_level = ${next(criteria.experimentalRiskLevel)}`);
    }

    try {
      const rows = await this.db.query<{
        latest_reservation_id: string;
        probability_no_show: number;
      }>(
        latestQuery(
          'r.model_key = $2',
          `SELECT latest_reservation_id, probability_no_show FROM latest
           WHERE ${conditions.join(' AND ')}`,
        ),
        params,
      );
      return rows.map((row) => ({
        reservationId: row.latest_reservation_id,
        probability: Number(row.probability_no_show),
      }));
    } catch (error) {
      throw toAppStoreException('RankLatestScores', error);
    }
  }

  async currentExperimentalPolicy(
    modelKey: MlModelKey,
    evidence: SnapshotEvidenceSource,
  ): Promise<ExperimentalPolicyIdentity | null> {
    try {
      const [row] = await this.db.query<{
        experimental_policy_id: string;
        experimental_policy_version: string;
        experimental_policy_hash: string;
      }>(
        `SELECT r.experimental_policy_id, r.experimental_policy_version, r.experimental_policy_hash
         FROM ml.app_prediction_model_results r
         JOIN ml.app_booking_feature_snapshots s
           ON s.snapshot_id = r.snapshot_id AND s.evidence_source = $1
         WHERE r.model_key = $2 AND r.experimental_policy_hash IS NOT NULL
         ORDER BY r.scored_at DESC, r.result_id DESC LIMIT 1`,
        [evidence, modelKey],
      );
      return row
        ? {
            policyId: row.experimental_policy_id,
            policyVersion: row.experimental_policy_version,
            policyHash: row.experimental_policy_hash,
          }
        : null;
    } catch (error) {
      throw toAppStoreException('FindExperimentalPolicy', error);
    }
  }
}
