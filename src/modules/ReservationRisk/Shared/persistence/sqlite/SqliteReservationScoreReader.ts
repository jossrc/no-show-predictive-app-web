import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
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
import { mapResultRow, RESULT_COLUMNS, toStoreException, type SqliteRow } from './SqliteRows.js';

/**
 * Último resultado por (reserva, modelo) entre snapshots con la evidencia del modo activo.
 * Desempate idéntico al detalle: scored_at DESC, result_id DESC.
 */
const LATEST_CTE = `
WITH latest AS (
  SELECT r.reservation_id AS latest_reservation_id, ${RESULT_COLUMNS},
         r.research_policy_key,
         ROW_NUMBER() OVER (
           PARTITION BY r.reservation_id, r.model_key
           ORDER BY r.scored_at DESC, r.result_id DESC
         ) AS position
  FROM prediction_model_results r
  JOIN booking_feature_snapshots s
    ON s.snapshot_id = r.snapshot_id AND s.evidence_source = ?
  JOIN prediction_runs pr ON pr.run_id = r.run_id
  WHERE %SCOPE%
)`;

function latestQuery(scope: string, select: string): string {
  return `${LATEST_CTE.replace('%SCOPE%', scope)}\n${select}`;
}

/** Lectura de scores del almacén local para el listado/detalle (sin N+1, sin PostgreSQL). */
export class SqliteReservationScoreReader implements ReservationScoreReader {
  constructor(private readonly db: DatabaseSync) {}

  async isAvailable(): Promise<boolean> {
    try {
      return this.db.isOpen && this.db.prepare('SELECT 1 AS ok').get()?.ok === 1;
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
      const rows = this.db
        .prepare(
          latestQuery(
            'r.reservation_id IN (SELECT value FROM json_each(?))',
            `SELECT * FROM latest WHERE position = 1 ORDER BY latest_reservation_id, model_key`,
          ),
        )
        .all(evidence, JSON.stringify(reservationIds));

      for (const row of rows as SqliteRow[]) {
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
      throw toStoreException('ListLatestScores', error);
    }
  }

  async reservationsWithUsableSnapshot(
    reservationIds: readonly DecimalId[],
    evidence: SnapshotEvidenceSource,
  ): Promise<ReadonlySet<DecimalId>> {
    if (reservationIds.length === 0) return new Set();
    try {
      const rows = this.db
        .prepare(
          `SELECT DISTINCT reservation_id FROM booking_feature_snapshots
           WHERE evidence_source = ? AND reservation_id IN (SELECT value FROM json_each(?))`,
        )
        .all(evidence, JSON.stringify(reservationIds));
      return new Set(rows.map((row) => String(row.reservation_id)));
    } catch (error) {
      throw toStoreException('ListUsableSnapshots', error);
    }
  }

  async rankLatest(criteria: ScoreRankingCriteria): Promise<readonly RankedScore[]> {
    const conditions = ['position = 1'];
    const params: SQLInputValue[] = [criteria.evidence, criteria.modelKey];
    if (criteria.probabilityRange) {
      conditions.push('probability_no_show >= ?', 'probability_no_show < ?');
      params.push(criteria.probabilityRange.minInclusive, criteria.probabilityRange.maxExclusive);
    }
    if (criteria.experimentalPolicyHash !== null) {
      conditions.push('research_policy_key = ?');
      params.push(criteria.experimentalPolicyHash);
    }
    if (criteria.experimentalRiskLevel !== null) {
      conditions.push('experimental_level = ?');
      params.push(criteria.experimentalRiskLevel);
    }

    try {
      return this.db
        .prepare(
          latestQuery(
            'r.model_key = ?',
            `SELECT latest_reservation_id, probability_no_show FROM latest
             WHERE ${conditions.join(' AND ')}`,
          ),
        )
        .all(...params)
        .map((row) => ({
          reservationId: String(row.latest_reservation_id),
          probability: Number(row.probability_no_show),
        }));
    } catch (error) {
      throw toStoreException('RankLatestScores', error);
    }
  }

  async currentExperimentalPolicy(
    modelKey: MlModelKey,
    evidence: SnapshotEvidenceSource,
  ): Promise<ExperimentalPolicyIdentity | null> {
    try {
      const row = this.db
        .prepare(
          `SELECT r.experimental_policy_id, r.experimental_policy_version, r.experimental_policy_hash
           FROM prediction_model_results r
           JOIN booking_feature_snapshots s
             ON s.snapshot_id = r.snapshot_id AND s.evidence_source = ?
           WHERE r.model_key = ? AND r.experimental_policy_hash IS NOT NULL
           ORDER BY r.scored_at DESC, r.result_id DESC LIMIT 1`,
        )
        .get(evidence, modelKey);
      return row
        ? {
            policyId: String(row.experimental_policy_id),
            policyVersion: String(row.experimental_policy_version),
            policyHash: String(row.experimental_policy_hash),
          }
        : null;
    } catch (error) {
      throw toStoreException('FindExperimentalPolicy', error);
    }
  }
}
