import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { PersistenceUnavailableException } from '../../../../src/infrastructure/database/errors/PersistenceUnavailableException.js';
import { AppStoreStatementBlockedException } from '../../../../src/infrastructure/database/postgres/PredictiveAppSqlGuard.js';
import type { MlResearchPredictionResponse } from '../../../../src/infrastructure/http/ml/MlContractTypes.js';
import { EXPERIMENTAL_RISK_LABELS } from '../../../../src/infrastructure/http/ml/MlResearchContractSchemas.js';
import { bandImpliedByContract } from '../../../../src/infrastructure/http/ml/MlResearchContractValidator.js';
import { toNewModelScore } from '../../../../src/modules/ReservationRisk/Shared/calculation/ToNewModelScore.js';
import type { BookingFeatureSnapshot } from '../../../../src/modules/ReservationRisk/Shared/models/BookingFeatureSnapshot.js';
import type { NewModelScore } from '../../../../src/modules/ReservationRisk/Shared/models/ModelScore.js';
import type { NewPredictionRun } from '../../../../src/modules/ReservationRisk/Shared/models/PredictionRun.js';
import { PostgresPredictiveStore } from '../../../../src/modules/ReservationRisk/Shared/persistence/postgres/PostgresPredictiveStore.js';
import { PendingValidationRiskLevelPolicy } from '../../../../src/modules/ReservationRisk/Shared/policy/PendingValidationRiskLevelPolicy.js';
import type { DataSourceMode } from '../../../../src/shared/data/DataSourceMode.js';
import { loadMlGolden } from '../../../helpers/LoadFixture.js';
import {
  makeStoredSnapshot,
  makeVerifiedSnapshot,
  UNSAFE_BIGINT_ID,
} from '../../../helpers/MakeSyntheticReservation.js';
import {
  createIsolatedStoreDatabase,
  type IsolatedStoreDatabase,
} from '../../../helpers/PredictiveStoreTestDatabase.js';
import { reportSkipped } from '../../../helpers/ReportSkipped.js';
import { probeTestDatabase } from '../../../helpers/TestDatabase.js';

const skip = await probeTestDatabase();
reportSkipped('PostgresPredictiveStore', skip);
const policy = new PendingValidationRiskLevelPolicy();
const RF_POLICY = '1d58ce962e899b758275f7191244225e8c970cf2db9661ffcb21be9b63a4ce74';

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

async function rejectsWith(promise: Promise<unknown>, reason: string): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) =>
      error instanceof PersistenceUnavailableException && error.metadata?.reason === reason,
  );
}

/**
 * Sustituto PostgreSQL del antiguo SqlitePredictiveStore.test (ADR-008): misma semántica de
 * idempotencia, inmutabilidad, contrato research v2 y lectura de scores, ahora sobre ml.app_* en
 * una base de PRUEBA aislada con el rol runtime restringido.
 */
describe(
  'PostgresPredictiveStore (ml.app_*, rol runtime restringido)',
  { skip: skip ?? false },
  () => {
    let database: IsolatedStoreDatabase;
    let store: PostgresPredictiveStore;
    const open = (mode: DataSourceMode = 'SYNTHETIC_DEMO_ONLY') =>
      PostgresPredictiveStore.open(database.runtime, { mode, allowPrivilegedRole: false });

    before(async () => {
      database = await createIsolatedStoreDatabase('SYNTHETIC_DEMO_ONLY');
      store = await open();
    });
    after(async () => {
      await store?.close();
      await database?.drop();
    });

    it('sobrevive al reinicio: cerrar el pool y reabrir recupera snapshot y scores v2 idénticos', async () => {
      const snapshot = await store.snapshots.saveIfAbsent(newSnapshot('900000000001001'));
      await store.results.saveRun(run(snapshot, ['random_forest_full_v1', 'xgboost_full_v1']), [
        v2Score(snapshot, 'rf'),
        v2Score(snapshot, 'xgb'),
      ]);
      await store.close();

      store = await open();
      const stored = await store.snapshots.findLatestUsable(
        '900000000001001',
        'SYNTHETIC_DEMO_ONLY',
      );
      assert.equal(stored?.snapshotHash, snapshot.snapshotHash);
      assert.deepEqual(stored?.features, snapshot.features);
      const scores = await store.results.findLatestBySnapshot(snapshot.snapshotId);
      assert.deepEqual(
        scores.map((s) => [s.modelKey, s.probabilityNoShow, s.experimentalRisk?.level]),
        [
          [
            'random_forest_full_v1',
            research('rf').probability_no_show,
            research('rf').experimental_risk.level,
          ],
          ['xgboost_full_v1', 0.9159286618232727, 'HIGH'],
        ],
      );
      assert.equal(scores[0]?.modelHashSha256, research('rf').model_hash_sha256);
      assert.deepEqual(
        scores[0]?.experimentalRisk?.warnings,
        research('rf').experimental_risk.warnings,
      );
      assert.equal(
        scores[0]?.experimentalRisk?.lowUpperThreshold,
        research('rf').experimental_risk.low_upper_threshold,
      );
      const health = await store.health();
      assert.deepEqual(
        [health.status, health.driver, health.schemaVersion, health.durable, health.restrictedRole],
        ['ok', 'postgresql', '003', true, true],
      );
    });

    it('falla cerrado: modo distinto, base sin ligar, sin migrar, otra base o rol privilegiado', async () => {
      await rejectsWith(open('READ_ONLY_EXISTING_SCHEDULE'), 'STORE_MODE_MISMATCH');
      await rejectsWith(
        PostgresPredictiveStore.verify(store.database, 'otra_base', {
          mode: 'SYNTHETIC_DEMO_ONLY',
          allowPrivilegedRole: false,
        }),
        'DATABASE_MISMATCH',
      );
      const unbound = await createIsolatedStoreDatabase('SYNTHETIC_DEMO_ONLY', { bind: false });
      const unmigrated = await createIsolatedStoreDatabase('SYNTHETIC_DEMO_ONLY', {
        migrate: false,
      });
      try {
        await rejectsWith(
          PostgresPredictiveStore.open(unbound.runtime, {
            mode: 'SYNTHETIC_DEMO_ONLY',
            allowPrivilegedRole: false,
          }),
          'STORE_NOT_BOUND',
        );
        await rejectsWith(
          PostgresPredictiveStore.open(unmigrated.runtime, {
            mode: 'SYNTHETIC_DEMO_ONLY',
            allowPrivilegedRole: false,
          }),
          'SCHEMA_VERSION_MISMATCH',
        );
        // El migrador (dueño de los objetos, con CREATE en ml) no puede ser el rol runtime.
        const migratorConfig = {
          ...database.runtime,
          user: 'noshow_app_migrator',
          password: 'test_only_migrator_pw',
        };
        await rejectsWith(
          PostgresPredictiveStore.open(migratorConfig, {
            mode: 'SYNTHETIC_DEMO_ONLY',
            allowPrivilegedRole: false,
          }),
          'PRIVILEGED_ROLE_REJECTED',
        );
      } finally {
        await unbound.drop();
        await unmigrated.drop();
      }
    });

    it('saveIfAbsent idempotente por (reserva, hash); BIGINT exacto; otra foto ⇒ snapshot nuevo', async () => {
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
    });

    it('6 guardados concurrentes idénticos ⇒ 1 run y 1 resultado por modelo+política (ganador leído)', async () => {
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
      assert.equal(new Set(outcomes.flatMap((o) => o.scores.map((s) => s.resultId))).size, 2);
      const admin = await database.connect('admin');
      try {
        const runs = await admin.query(
          'SELECT 1 FROM ml.app_prediction_runs WHERE reservation_id = 900000000007001',
        );
        assert.equal(runs.rowCount, 1, 'sin runs huérfanos de los perdedores');
      } finally {
        await admin.end();
      }
    });

    it('idempotencia por política: v1 y v2 del mismo modelo coexisten sin reinterpretar', async () => {
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
          researchPolicyHash: RF_POLICY,
        },
      ]);
      assert.equal(byV2[0]?.scoringApiVersion, 'v2');
      const latest = await store.results.findLatestBySnapshot(snapshot.snapshotId);
      assert.equal(latest[0]?.scoringApiVersion, 'v2', 'el último score por scored_at prevalece');
      // Lectura por run (Sprint 02): solo resultados de ese run y de esa reserva.
      const byRun = await store.results.findRunResults(
        snapshot.reservationId,
        outcome.createdRunUid!,
        'SYNTHETIC_DEMO_ONLY',
      );
      assert.deepEqual(
        byRun.map((s) => s.scoringApiVersion),
        ['v2'],
      );
      assert.deepEqual(
        await store.results.findRunResults(
          '900000000001001',
          outcome.createdRunUid!,
          'SYNTHETIC_DEMO_ONLY',
        ),
        [],
      );
      assert.deepEqual(
        await store.results.findRunResults(
          snapshot.reservationId,
          'no-es-uuid',
          'SYNTHETIC_DEMO_ONLY',
        ),
        [],
      );
    });

    it('float64 sin redondeo; inmutable (triggers + privilegios) y CHECKs del contrato v2', async () => {
      const snapshot = await store.snapshots.saveIfAbsent(newSnapshot('900000000007003'));
      await store.results.saveRun(run(snapshot, ['random_forest_full_v1']), [
        v2Score(snapshot, 'rf', 0.30219233441199996),
      ]);
      const [score] = await store.results.findLatestBySnapshot(snapshot.snapshotId);
      assert.equal(score?.probabilityNoShow, 0.30219233441199996);

      // La conexión de la app rechaza UPDATE/DELETE antes de enviarlos (guard)…
      for (const sql of [
        'UPDATE ml.app_prediction_model_results SET probability_no_show = 0.1',
        'DELETE FROM ml.app_prediction_runs',
      ]) {
        await assert.rejects(store.database.query(sql), AppStoreStatementBlockedException, sql);
      }
      // …el rol runtime no tiene privilegios para hacerlo…
      const runtime = await database.connect('runtime');
      const admin = await database.connect('admin');
      try {
        for (const sql of [
          'UPDATE ml.app_prediction_model_results SET probability_no_show = 0.1',
          'DELETE FROM ml.app_booking_feature_snapshots',
          'TRUNCATE ml.app_prediction_runs',
        ]) {
          await assert.rejects(
            runtime.query(sql),
            (error: { code?: string }) => error.code === '42501',
            sql,
          );
        }
        // …y ni siquiera un superusuario puede mutar: triggers de inmutabilidad.
        for (const sql of [
          'UPDATE ml.app_prediction_model_results SET probability_no_show = 0.1',
          'DELETE FROM ml.app_booking_feature_snapshots',
          'TRUNCATE ml.app_space_recovery_outcomes',
        ]) {
          await assert.rejects(admin.query(sql), /inmutables/, sql);
        }
        const insert = (overrides: string, values: string) =>
          admin.query(`INSERT INTO ml.app_prediction_model_results (run_id, snapshot_id, reservation_id, model_key,
          algorithm, model_version, model_hash, feature_version, prediction_at, scored_at,
          probability_no_show, prediction_target, validation_status, calibration_status,
          operational_use_allowed, risk_policy_status, scoring_api_version, research_policy_key${overrides})
          SELECT r.run_id, r.snapshot_id, r.reservation_id, ${values}
          FROM ml.app_prediction_runs r WHERE r.reservation_id = 900000000007003 LIMIT 1`);
        const base = `'xgboost_full_v1', 'xgboost', 'x', 'x', 'B', now(), now(), 0.5, 'NO_SHOW_CANDIDATE', 'E', 'C'`;
        const check = (error: { code?: string }) => error.code === '23514';
        await assert.rejects(
          insert('', `${base}, true, 'pending_validation', 'v1', ''`),
          check,
          'uso operativo',
        );
        await assert.rejects(
          insert(', risk_level', `${base}, false, 'pending_validation', 'v1', '', 'HIGH'`),
          check,
          'riskLevel sin política aprobada',
        );
        await assert.rejects(
          insert(', experimental_level', `${base}, false, 'pending_validation', 'v2', '', 'LOW'`),
          check,
          'banda incompleta',
        );
        await assert.rejects(
          insert(
            '',
            `${base.replace("'xgboost'", "'random_forest'")}, false, 'pending_validation', 'v1', ''`,
          ),
          check,
          'algoritmo incoherente',
        );
      } finally {
        await runtime.end();
        await admin.end();
      }
    });

    it('lector de scores: último por modelo, ranking global con filtros y política vigente', async () => {
      for (const [id, p] of [
        ['900000000008001', 0.2],
        ['900000000008002', 0.4],
        ['900000000008003', 0.8],
      ] as const) {
        const snapshot = await store.snapshots.saveIfAbsent(newSnapshot(id));
        const response = research('rf', p);
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
      const high = await store.scores.rankLatest({
        modelKey: 'random_forest_full_v1',
        evidence: 'SYNTHETIC_DEMO_ONLY',
        probabilityRange: null,
        experimentalPolicyHash: RF_POLICY,
        experimentalRiskLevel: 'HIGH',
      });
      assert.ok(
        high.some((row) => row.reservationId === '900000000008003' && row.probability === 0.8),
      );
      assert.ok(!high.some((row) => row.reservationId === '900000000008001'));
      assert.deepEqual(
        await store.scores.rankLatest({
          modelKey: 'random_forest_full_v1',
          evidence: 'SYNTHETIC_DEMO_ONLY',
          probabilityRange: null,
          experimentalPolicyHash: 'f'.repeat(64),
          experimentalRiskLevel: null,
        }),
        [],
        'no se mezclan políticas',
      );
      assert.equal(
        (
          await store.scores.currentExperimentalPolicy(
            'random_forest_full_v1',
            'SYNTHETIC_DEMO_ONLY',
          )
        )?.policyHash,
        RF_POLICY,
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
      assert.deepEqual(
        await store.scores.reservationsWithUsableSnapshot(
          ['900000000008002', '42'],
          'SYNTHETIC_DEMO_ONLY',
        ),
        new Set(['900000000008002']),
      );
      assert.equal(await store.scores.isAvailable(), true);
    });
  },
);
