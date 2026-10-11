import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import type { Sequelize } from 'sequelize-typescript';
import { PersistenceUnavailableException } from '../../../../src/infrastructure/database/errors/PersistenceUnavailableException.js';
import type { NewModelScore } from '../../../../src/modules/ReservationRisk/Shared/models/ModelScore.js';
import { SequelizeBookingSnapshotRepository } from '../../../../src/modules/ReservationRisk/Shared/persistence/sequelize/SequelizeBookingSnapshotRepository.js';
import { SequelizePredictionResultRepository } from '../../../../src/modules/ReservationRisk/Shared/persistence/sequelize/SequelizePredictionResultRepository.js';
import {
  makeStoredSnapshot,
  makeVerifiedSnapshot,
  UNSAFE_BIGINT_ID,
} from '../../../helpers/MakeSyntheticReservation.js';
import {
  connectPg,
  countRows,
  createTestSequelize,
  probeTestDatabase,
  resetTestDatabase,
} from '../../../helpers/TestDatabase.js';
import { reportSkipped } from '../../../helpers/ReportSkipped.js';

const skip = await probeTestDatabase();

describe(
  'Almacén predictivo ml (snapshots, runs, resultados idempotentes)',
  { skip: skip ?? false },
  () => {
    let sequelize: Sequelize;
    let client: pg.Client;
    let snapshots: SequelizeBookingSnapshotRepository;
    let results: SequelizePredictionResultRepository;

    before(async () => {
      await resetTestDatabase();
      client = await connectPg();
      sequelize = createTestSequelize();
      snapshots = new SequelizeBookingSnapshotRepository(sequelize);
      results = new SequelizePredictionResultRepository(sequelize);
    });
    after(async () => {
      await sequelize?.close();
      await client?.end();
    });

    const newSnapshot = (reservationId: string, fwaFlag = 0) => {
      const {
        snapshotId: _s,
        createdAt: _c,
        ...rest
      } = makeStoredSnapshot({
        verified: makeVerifiedSnapshot({
          reservationId,
          fwaFlag,
          evidenceSource: 'SYNTHETIC_DEMO_ONLY',
        }),
        evidenceSource: 'SYNTHETIC_DEMO_ONLY',
      });
      return { ...rest, evidence: { source: 'synthetic-test' }, sourceIngestionBatchId: null };
    };

    const score = (
      snapshotId: string,
      modelKey: 'random_forest_full_v1' | 'xgboost_full_v1',
      probability: number,
    ): NewModelScore => ({
      snapshotId,
      modelKey,
      algorithm: modelKey === 'xgboost_full_v1' ? 'xgboost' : 'random_forest',
      modelVersion: `${modelKey}:abc123def456`,
      modelHash: 'abc123def456',
      featureVersion: 'BOOKING_BASELINE_V1',
      predictionAt: new Date('2026-10-20T16:00:00Z'),
      scoredAt: new Date(),
      probabilityNoShow: probability,
      predictionTarget: 'NO_SHOW_CANDIDATE',
      validationStatus: 'EXPLORATORY_NOT_VALIDATED',
      calibrationStatus: 'not_operationally_validated',
      operationalUseAllowed: false,
      riskLevel: null,
      riskPolicyVersion: null,
      riskPolicyStatus: 'pending_validation',
    });

    const run = (
      snapshotId: string,
      reservationId: string,
      keys: Array<'random_forest_full_v1' | 'xgboost_full_v1'>,
    ) => ({
      runUid: randomUUID(),
      snapshotId,
      reservationId,
      mode: keys.length === 2 ? ('compare' as const) : ('single' as const),
      requestedModelKeys: keys,
      requestId: 'req-it',
      runRequestedAt: new Date(Date.now() - 5),
      completedAt: new Date(),
      mlLatencyMs: 5,
    });

    it('saveIfAbsent es idempotente por (reserva, hash); otra evidencia ⇒ snapshot nuevo; BIGINT exacto; JSON intacto', async () => {
      const first = await snapshots.saveIfAbsent(newSnapshot(UNSAFE_BIGINT_ID));
      const again = await snapshots.saveIfAbsent(newSnapshot(UNSAFE_BIGINT_ID));
      assert.equal(again.snapshotId, first.snapshotId);
      assert.equal(first.reservationId, '9007199254740993');
      assert.deepEqual(first.features, newSnapshot(UNSAFE_BIGINT_ID).features);
      const changed = await snapshots.saveIfAbsent(newSnapshot(UNSAFE_BIGINT_ID, -1));
      assert.notEqual(changed.snapshotId, first.snapshotId);
      assert.equal(
        (await snapshots.findLatestUsable(UNSAFE_BIGINT_ID, 'SYNTHETIC_DEMO_ONLY'))?.snapshotId,
        changed.snapshotId,
      );
      assert.equal(
        await snapshots.findLatestUsable(UNSAFE_BIGINT_ID, 'VERIFIED_BOOKING_SNAPSHOT'),
        null,
      );
    });

    it('peticiones concurrentes idénticas ⇒ exactamente un run y un resultado por modelo (UNIQUE + lectura del ganador)', async () => {
      const snapshot = await snapshots.saveIfAbsent(newSnapshot('900000000007001'));
      const outcomes = await Promise.all(
        Array.from({ length: 6 }, () =>
          results.saveRun(
            run(snapshot.snapshotId, '900000000007001', [
              'random_forest_full_v1',
              'xgboost_full_v1',
            ]),
            [
              score(snapshot.snapshotId, 'random_forest_full_v1', 0.61),
              score(snapshot.snapshotId, 'xgboost_full_v1', 0.72),
            ],
          ),
        ),
      );
      assert.equal(outcomes.filter((o) => o.createdRunUid !== null).length, 1);
      const winnerIds = new Set(outcomes.flatMap((o) => o.scores.map((s) => s.resultId)));
      assert.equal(winnerIds.size, 2, 'todas las respuestas leen los mismos registros ganadores');
      const persisted = await client.query(
        `SELECT count(*)::int AS n FROM ml.prediction_model_results WHERE snapshot_id = $1`,
        [snapshot.snapshotId],
      );
      assert.equal(persisted.rows[0].n, 2);
      const runs = await client.query(
        `SELECT count(*)::int AS n FROM ml.prediction_runs WHERE snapshot_id = $1`,
        [snapshot.snapshotId],
      );
      assert.equal(runs.rows[0].n, 1, 'sin runs huérfanos');
    });

    it('compare tras single solo inserta el modelo faltante; latest por modelo; probabilidad sin redondeo', async () => {
      const snapshot = await snapshots.saveIfAbsent(newSnapshot('900000000007002'));
      await results.saveRun(
        run(snapshot.snapshotId, '900000000007002', ['random_forest_full_v1']),
        [score(snapshot.snapshotId, 'random_forest_full_v1', 0.6976400433344135)],
      );
      const outcome = await results.saveRun(
        run(snapshot.snapshotId, '900000000007002', ['random_forest_full_v1', 'xgboost_full_v1']),
        [
          score(snapshot.snapshotId, 'random_forest_full_v1', 0.1),
          score(snapshot.snapshotId, 'xgboost_full_v1', 0.9159286618232727),
        ],
      );
      assert.ok(outcome.createdRunUid);
      const latest = await results.findLatestBySnapshot(snapshot.snapshotId);
      assert.deepEqual(
        latest.map((s) => [s.modelKey, s.probabilityNoShow]),
        [
          ['random_forest_full_v1', 0.6976400433344135],
          ['xgboost_full_v1', 0.9159286618232727],
        ],
      );
      assert.ok(latest.every((s) => s.operationalUseAllowed === false && s.riskLevel === null));
    });

    it('schema ml sin migrar ⇒ PERSISTENCE_UNAVAILABLE (PREDICTIVE_SCHEMA_NOT_MIGRATED), sin stack público', async () => {
      const before = await countRows(client, 'ml.prediction_runs');
      assert.ok(before >= 1);
      await client.query(
        'DROP TABLE ml.prediction_model_results, ml.prediction_runs, ml.booking_feature_snapshots',
      );
      await assert.rejects(
        snapshots.findLatestUsable('1', 'SYNTHETIC_DEMO_ONLY'),
        (error: unknown) => {
          assert.ok(error instanceof PersistenceUnavailableException);
          assert.equal(error.metadata?.reason, 'PREDICTIVE_SCHEMA_NOT_MIGRATED');
          return true;
        },
      );
    });
  },
);
reportSkipped('SequelizePredictionStore', skip);
