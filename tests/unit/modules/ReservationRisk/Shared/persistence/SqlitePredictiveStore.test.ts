import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';
import { PersistenceUnavailableException } from '../../../../../../src/infrastructure/database/errors/PersistenceUnavailableException.js';
import type { MlResearchPredictionResponse } from '../../../../../../src/infrastructure/http/ml/MlContractTypes.js';
import { EXPERIMENTAL_RISK_LABELS } from '../../../../../../src/infrastructure/http/ml/MlResearchContractSchemas.js';
import { bandImpliedByContract } from '../../../../../../src/infrastructure/http/ml/MlResearchContractValidator.js';
import { toNewModelScore } from '../../../../../../src/modules/ReservationRisk/Shared/calculation/ToNewModelScore.js';
import type { BookingFeatureSnapshot } from '../../../../../../src/modules/ReservationRisk/Shared/models/BookingFeatureSnapshot.js';
import type { NewModelScore } from '../../../../../../src/modules/ReservationRisk/Shared/models/ModelScore.js';
import type { NewPredictionRun } from '../../../../../../src/modules/ReservationRisk/Shared/models/PredictionRun.js';
import { SqlitePredictiveStore } from '../../../../../../src/modules/ReservationRisk/Shared/persistence/sqlite/SqlitePredictiveStore.js';
import { PendingValidationRiskLevelPolicy } from '../../../../../../src/modules/ReservationRisk/Shared/policy/PendingValidationRiskLevelPolicy.js';
import { loadMlGolden } from '../../../../../helpers/LoadFixture.js';
import {
  makeStoredSnapshot,
  makeVerifiedSnapshot,
  UNSAFE_BIGINT_ID,
} from '../../../../../helpers/MakeSyntheticReservation.js';

const directory = mkdtempSync(path.join(os.tmpdir(), 'nsp-store-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const policy = new PendingValidationRiskLevelPolicy();

function newSnapshot(reservationId: string, hours = 0) {
  const verified = makeVerifiedSnapshot({
    reservationId,
    evidenceSource: 'SYNTHETIC_DEMO_ONLY',
    predictionAt: new Date(Date.parse('2026-10-20T16:00:00.000Z') + hours * 3_600_000),
  });
  const { snapshotId: _id, createdAt: _at, ...rest } = makeStoredSnapshot({ verified });
  return { ...rest, evidence: { capture: 'SYNTHETIC_DEMO_ONLY' }, sourceIngestionBatchId: null };
}

function research(model: 'rf' | 'xgb', probability?: number): MlResearchPredictionResponse {
  const golden = loadMlGolden<MlResearchPredictionResponse>(`golden_v2_predict_${model}`);
  return probability === undefined ? golden : { ...golden, probability_no_show: probability };
}

function v2Score(snapshot: BookingFeatureSnapshot, model: 'rf' | 'xgb', p?: number): NewModelScore {
  return toNewModelScore(research(model, p), snapshot, new Date(), policy);
}

function run(
  snapshot: BookingFeatureSnapshot,
  keys: NewPredictionRun['requestedModelKeys'],
): NewPredictionRun {
  return {
    runUid: randomUUID(),
    snapshotId: snapshot.snapshotId,
    reservationId: snapshot.reservationId,
    mode: keys.length === 2 ? 'compare' : 'single',
    requestedModelKeys: keys,
    requestId: 'store-test',
    runRequestedAt: new Date(),
    completedAt: new Date(),
    mlLatencyMs: 3.6,
    scoringApiVersion: 'v2',
  };
}

describe('SqlitePredictiveStore (almacén predictivo local, PostgreSQL intacto)', () => {
  it('sobrevive al reinicio: el histórico persiste en el archivo y se recupera tras reabrir', async () => {
    const file = path.join(directory, 'restart.sqlite');
    const first = SqlitePredictiveStore.open({ path: file, mode: 'SYNTHETIC_DEMO_ONLY' });
    const snapshot = await first.snapshots.saveIfAbsent(newSnapshot('900000000001001'));
    await first.results.saveRun(run(snapshot, ['random_forest_full_v1', 'xgboost_full_v1']), [
      v2Score(snapshot, 'rf'),
      v2Score(snapshot, 'xgb'),
    ]);
    first.close();

    const reopened = SqlitePredictiveStore.open({ path: file, mode: 'SYNTHETIC_DEMO_ONLY' });
    const stored = await reopened.snapshots.findLatestUsable(
      '900000000001001',
      'SYNTHETIC_DEMO_ONLY',
    );
    assert.equal(stored?.snapshotHash, snapshot.snapshotHash);
    assert.deepEqual(stored?.features, snapshot.features);
    const scores = await reopened.results.findLatestBySnapshot(snapshot.snapshotId);
    assert.deepEqual(
      scores.map((s) => [
        s.modelKey,
        s.probabilityNoShow,
        s.experimentalRisk?.level,
        s.experimentalRisk?.policyHash.slice(0, 12),
      ]),
      [
        [
          'random_forest_full_v1',
          research('rf').probability_no_show,
          research('rf').experimental_risk.level,
          '1d58ce962e89',
        ],
        ['xgboost_full_v1', 0.9159286618232727, 'HIGH', '208c706d839b'],
      ],
    );
    assert.equal(scores[0]?.modelHashSha256, research('rf').model_hash_sha256);
    assert.deepEqual(
      scores[0]?.experimentalRisk?.warnings,
      research('rf').experimental_risk.warnings,
    );
    assert.equal(reopened.health().status, 'ok');
    assert.equal(reopened.health().durable, true);
    reopened.close();
  });

  it('archivo privado: directorio 0700 y archivo 0600 (contiene edad/sexo de snapshots)', () => {
    const file = path.join(directory, 'private', 'perm.sqlite');
    SqlitePredictiveStore.open({ path: file, mode: 'READ_ONLY_EXISTING_SCHEDULE' }).close();
    assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });

  it('un archivo sintético no puede abrirse en modo real (ni viceversa): PERSISTENCE_UNAVAILABLE', () => {
    const file = path.join(directory, 'mode.sqlite');
    SqlitePredictiveStore.open({ path: file, mode: 'SYNTHETIC_DEMO_ONLY' }).close();
    assert.throws(
      () => SqlitePredictiveStore.open({ path: file, mode: 'READ_ONLY_EXISTING_SCHEDULE' }),
      (error: unknown) =>
        error instanceof PersistenceUnavailableException &&
        error.metadata?.reason === 'STORE_MODE_MISMATCH',
    );
  });

  it('saveIfAbsent idempotente por (reserva, hash); BIGINT exacto; otra foto ⇒ snapshot nuevo', async () => {
    const store = SqlitePredictiveStore.open({ path: ':memory:', mode: 'SYNTHETIC_DEMO_ONLY' });
    const first = await store.snapshots.saveIfAbsent(newSnapshot(UNSAFE_BIGINT_ID));
    const again = await store.snapshots.saveIfAbsent(newSnapshot(UNSAFE_BIGINT_ID));
    assert.equal(again.snapshotId, first.snapshotId);
    assert.equal(first.reservationId, '9007199254740993');
    const other = await store.snapshots.saveIfAbsent(newSnapshot(UNSAFE_BIGINT_ID, -1));
    assert.notEqual(other.snapshotId, first.snapshotId);
    assert.equal(
      await store.snapshots.findLatestUsable(UNSAFE_BIGINT_ID, 'VERIFIED_BOOKING_SNAPSHOT'),
      null,
    );
    store.close();
  });

  it('6 guardados concurrentes idénticos ⇒ 1 run y 1 resultado por modelo+política (ganador leído)', async () => {
    const store = SqlitePredictiveStore.open({ path: ':memory:', mode: 'SYNTHETIC_DEMO_ONLY' });
    const snapshot = await store.snapshots.saveIfAbsent(newSnapshot('900000000007001'));
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () =>
        store.results.saveRun(run(snapshot, ['random_forest_full_v1', 'xgboost_full_v1']), [
          v2Score(snapshot, 'rf'),
          v2Score(snapshot, 'xgb'),
        ]),
      ),
    );
    assert.equal(outcomes.filter((o) => o.createdRunUid !== null).length, 1);
    const winners = new Set(outcomes.flatMap((o) => o.scores.map((s) => s.resultId)));
    assert.equal(winners.size, 2);
    assert.equal((await store.results.findLatestBySnapshot(snapshot.snapshotId)).length, 2);
    store.close();
  });

  it('idempotencia por política: v1 y v2 (o dos políticas) del mismo modelo coexisten sin reinterpretar', async () => {
    const store = SqlitePredictiveStore.open({ path: ':memory:', mode: 'SYNTHETIC_DEMO_ONLY' });
    const snapshot = await store.snapshots.saveIfAbsent(newSnapshot('900000000007002'));
    const v1 = toNewModelScore(
      loadMlGolden('golden_predict_rf'),
      snapshot,
      new Date('2026-10-21Z'),
      policy,
    );
    await store.results.saveRun(
      { ...run(snapshot, ['random_forest_full_v1']), scoringApiVersion: 'v1' },
      [v1],
    );
    const v2 = { ...v2Score(snapshot, 'rf'), scoredAt: new Date('2026-10-22Z') };
    const outcome = await store.results.saveRun(run(snapshot, ['random_forest_full_v1']), [v2]);
    assert.notEqual(outcome.createdRunUid, null, 'otra política ⇒ score nuevo, no reutilizado');

    const byV1 = await store.results.findByIdentities(snapshot.snapshotId, [
      {
        modelKey: 'random_forest_full_v1',
        modelVersion: v1.modelVersion,
        researchPolicyHash: null,
      },
    ]);
    assert.equal(byV1[0]?.experimentalRisk, null);
    const byV2 = await store.results.findByIdentities(snapshot.snapshotId, [
      {
        modelKey: 'random_forest_full_v1',
        modelVersion: v2.modelVersion,
        researchPolicyHash: '1d58ce962e899b758275f7191244225e8c970cf2db9661ffcb21be9b63a4ce74',
      },
    ]);
    assert.equal(byV2[0]?.scoringApiVersion, 'v2');
    const latest = await store.results.findLatestBySnapshot(snapshot.snapshotId);
    assert.equal(latest[0]?.scoringApiVersion, 'v2', 'el último score por scored_at prevalece');
    store.close();
  });

  it('probabilidad float64 sin redondeo; inmutable (sin UPDATE/DELETE) y CHECKs operativos', async () => {
    const file = path.join(directory, 'checks.sqlite');
    const store = SqlitePredictiveStore.open({ path: file, mode: 'SYNTHETIC_DEMO_ONLY' });
    const snapshot = await store.snapshots.saveIfAbsent(newSnapshot('900000000007003'));
    await store.results.saveRun(run(snapshot, ['random_forest_full_v1']), [
      v2Score(snapshot, 'rf', 0.30219233441199996),
    ]);
    const [score] = await store.results.findLatestBySnapshot(snapshot.snapshotId);
    assert.equal(score?.probabilityNoShow, 0.30219233441199996);

    const raw = new DatabaseSync(file);
    for (const sql of [
      'UPDATE prediction_model_results SET probability_no_show = 0.1',
      'DELETE FROM booking_feature_snapshots',
      'DELETE FROM prediction_runs',
      "UPDATE booking_feature_snapshots SET features_json = '{}'",
    ]) {
      assert.throws(() => raw.exec(sql), /inmutable/, sql);
    }
    const insert = (overrides: string) =>
      raw.exec(`INSERT INTO prediction_model_results (run_id, snapshot_id, reservation_id, model_key,
        algorithm, model_version, model_hash, feature_version, prediction_at, scored_at,
        probability_no_show, prediction_target, validation_status, calibration_status,
        operational_use_allowed, risk_policy_status, scoring_api_version${overrides})`);
    const base = `1, ${snapshot.snapshotId}, '900000000007003', 'xgboost_full_v1', 'xgboost', 'x', 'x', 'B', 'a', 'b', 0.5, 'NO_SHOW_CANDIDATE', 'E', 'C'`;
    assert.throws(() => insert(`) VALUES (${base}, 1, 'pending_validation', 'v1'`), /CHECK/);
    assert.throws(
      () => insert(`, risk_level) VALUES (${base}, 0, 'pending_validation', 'v1', 'HIGH'`),
      /CHECK/,
      'riskLevel operativo sin política aprobada',
    );
    assert.throws(
      () => insert(`, experimental_level) VALUES (${base}, 0, 'pending_validation', 'v2', 'LOW'`),
      /CHECK/,
      'banda experimental incompleta',
    );
    assert.throws(
      () =>
        insert(
          `) VALUES (${base.replace("'xgboost'", "'random_forest'")}, 0, 'pending_validation', 'v1'`,
        ),
      /CHECK/,
      'algoritmo incoherente con el modelo',
    );
    raw.close();
    store.close();
  });

  it('lector de scores: último por modelo, ranking global con filtros y política vigente', async () => {
    const store = SqlitePredictiveStore.open({ path: ':memory:', mode: 'SYNTHETIC_DEMO_ONLY' });
    for (const [id, p] of [
      ['900000000008001', 0.2],
      ['900000000008002', 0.4],
      ['900000000008003', 0.8],
    ] as const) {
      const snapshot = await store.snapshots.saveIfAbsent(newSnapshot(id));
      const response = research('rf', p);
      // Doble de Python: regla publicada con los límites de la propia respuesta real.
      const level = bandImpliedByContract(p, response.experimental_risk);
      const banded: MlResearchPredictionResponse = {
        ...response,
        experimental_risk: {
          ...response.experimental_risk,
          level,
          label: EXPERIMENTAL_RISK_LABELS[level],
        },
      };
      await store.results.saveRun(run(snapshot, ['random_forest_full_v1']), [
        toNewModelScore(banded, snapshot, new Date(), policy),
      ]);
    }
    const latest = await store.scores.latestScores(
      ['900000000008001', '900000000008003', '1'],
      'SYNTHETIC_DEMO_ONLY',
    );
    assert.equal(latest.get('900000000008001')?.[0]?.experimentalRisk?.level, 'LOW');
    assert.equal(latest.get('1'), undefined);

    const policyHash = '1d58ce962e899b758275f7191244225e8c970cf2db9661ffcb21be9b63a4ce74';
    const high = await store.scores.rankLatest({
      modelKey: 'random_forest_full_v1',
      evidence: 'SYNTHETIC_DEMO_ONLY',
      probabilityRange: null,
      experimentalPolicyHash: policyHash,
      experimentalRiskLevel: 'HIGH',
    });
    assert.deepEqual(high, [{ reservationId: '900000000008003', probability: 0.8 }]);
    const otherPolicy = await store.scores.rankLatest({
      modelKey: 'random_forest_full_v1',
      evidence: 'SYNTHETIC_DEMO_ONLY',
      probabilityRange: null,
      experimentalPolicyHash: 'f'.repeat(64),
      experimentalRiskLevel: null,
    });
    assert.deepEqual(otherPolicy, [], 'no se mezclan políticas');
    assert.equal(
      (await store.scores.currentExperimentalPolicy('random_forest_full_v1', 'SYNTHETIC_DEMO_ONLY'))
        ?.policyHash,
      policyHash,
    );
    assert.equal(
      await store.scores.currentExperimentalPolicy('xgboost_full_v1', 'SYNTHETIC_DEMO_ONLY'),
      null,
    );
    assert.equal(
      (
        await store.scores.rankLatest({
          modelKey: 'random_forest_full_v1',
          evidence: 'VERIFIED_BOOKING_SNAPSHOT',
          probabilityRange: null,
          experimentalPolicyHash: null,
          experimentalRiskLevel: null,
        })
      ).length,
      0,
      'scores sintéticos invisibles para la evidencia real',
    );
    store.close();
  });
});
