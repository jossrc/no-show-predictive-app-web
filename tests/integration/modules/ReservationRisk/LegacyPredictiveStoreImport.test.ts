import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MlResearchPredictionResponse } from '../../../../src/infrastructure/http/ml/MlContractTypes.js';
import { toCanonicalFeatures } from '../../../../src/infrastructure/http/ml/MlFeatureContract.js';
import {
  importLegacyPredictiveStore,
  LegacyImportError,
  type LegacyPredictiveStoreDump,
  type LegacyRow,
} from '../../../../src/modules/ReservationRisk/Shared/persistence/postgres/LegacyPredictiveStoreImporter.js';
import { PostgresPredictiveStore } from '../../../../src/modules/ReservationRisk/Shared/persistence/postgres/PostgresPredictiveStore.js';
import { loadMlGolden } from '../../../helpers/LoadFixture.js';
import {
  makeStoredSnapshot,
  makeVerifiedSnapshot,
} from '../../../helpers/MakeSyntheticReservation.js';
import {
  createIsolatedStoreDatabase,
  type IsolatedStoreDatabase,
} from '../../../helpers/PredictiveStoreTestDatabase.js';
import { reportSkipped } from '../../../helpers/ReportSkipped.js';
import { probeTestDatabase } from '../../../helpers/TestDatabase.js';

const skip = await probeTestDatabase();
reportSkipped('LegacyPredictiveStoreImport', skip);

const RUN_UID = '11111111-2222-4333-8444-555555555555';
const RESERVATION = '900000000401001';

/** Filas con la forma EXACTA del esquema SQLite de Sprint 01 (texto ISO, JSON en texto, 0/1). */
function syntheticDump(): LegacyPredictiveStoreDump {
  const stored = makeStoredSnapshot({
    verified: makeVerifiedSnapshot({
      reservationId: RESERVATION,
      evidenceSource: 'SYNTHETIC_DEMO_ONLY',
    }),
    evidenceSource: 'SYNTHETIC_DEMO_ONLY',
  });
  const snapshot: LegacyRow = {
    snapshot_id: 7,
    reservation_id: RESERVATION,
    client_id: stored.clientId,
    snapshot_type: 'booking_creation',
    prediction_at: stored.predictionAt.toISOString(),
    appointment_at: stored.appointmentAt.toISOString(),
    feature_version: stored.featureVersion,
    builder_version: stored.builderVersion,
    snapshot_hash: stored.snapshotHash,
    features_json: JSON.stringify(toCanonicalFeatures(stored.features)),
    evidence_source: 'SYNTHETIC_DEMO_ONLY',
    evidence_json: '{"capture":"SYNTHETIC_DEMO_ONLY"}',
    source_ingestion_batch_id: null,
    created_at: '2026-10-11T21:00:00.000Z',
  };
  const run: LegacyRow = {
    run_id: 3,
    run_uid: RUN_UID,
    snapshot_id: 7,
    reservation_id: RESERVATION,
    mode: 'compare',
    requested_model_keys_json: '["random_forest_full_v1","xgboost_full_v1"]',
    scoring_api_version: 'v2',
    request_id: 'legacy-synthetic',
    run_requested_at: '2026-10-11T21:00:01.000Z',
    completed_at: '2026-10-11T21:00:02.000Z',
    ml_latency_ms: 12,
  };
  const results = (['rf', 'xgb'] as const).map((model, index): LegacyRow => {
    const golden = loadMlGolden<MlResearchPredictionResponse>(`golden_v2_predict_${model}`);
    const risk = golden.experimental_risk;
    return {
      result_id: 11 + index,
      run_id: 3,
      snapshot_id: 7,
      reservation_id: RESERVATION,
      model_key: golden.model_key,
      algorithm: model === 'rf' ? 'random_forest' : 'xgboost',
      model_version: golden.model_version,
      model_hash: golden.model_hash,
      model_hash_sha256: golden.model_hash_sha256,
      feature_version: stored.featureVersion,
      prediction_at: stored.predictionAt.toISOString(),
      scored_at: '2026-10-11T21:00:02.000Z',
      probability_no_show: golden.probability_no_show,
      prediction_target: 'NO_SHOW_CANDIDATE',
      validation_status: 'EXPLORATORY_NOT_VALIDATED',
      calibration_status: 'not_operationally_validated',
      operational_use_allowed: 0,
      risk_level: null,
      risk_policy_version: null,
      risk_policy_status: 'pending_validation',
      scoring_api_version: 'v2',
      research_policy_key: risk.policy_hash,
      experimental_level: risk.level,
      experimental_label: risk.label,
      experimental_status: risk.status,
      experimental_policy_id: risk.policy_id,
      experimental_policy_version: risk.policy_version,
      experimental_policy_hash: risk.policy_hash,
      experimental_low_upper_threshold: risk.low_upper_threshold,
      experimental_high_lower_threshold: risk.high_lower_threshold,
      experimental_boundary_rule: risk.boundary_rule,
      experimental_meaning: risk.meaning,
      experimental_score_space: risk.score_space,
      experimental_warnings_json: JSON.stringify(risk.warnings),
      experimental_approved_by: null,
      experimental_operational_use_allowed: 0,
    };
  });
  return { dataSourceMode: 'SYNTHETIC_DEMO_ONLY', snapshots: [snapshot], runs: [run], results };
}

describe(
  'Importación puntual del histórico SQLite a ml.app_* (sin SQLite en la prueba)',
  { skip: skip ?? false },
  () => {
    let database: IsolatedStoreDatabase;
    let store: PostgresPredictiveStore;

    before(async () => {
      database = await createIsolatedStoreDatabase('SYNTHETIC_DEMO_ONLY');
      store = await PostgresPredictiveStore.open(database.runtime, {
        mode: 'SYNTHETIC_DEMO_ONLY',
        allowPrivilegedRole: false,
      });
    });
    after(async () => {
      await store?.close();
      await database?.drop();
    });

    it('importa en orden FK con el rol runtime, conserva identidades y reconcilia contenido exacto', async () => {
      const dump = syntheticDump();
      const report = await importLegacyPredictiveStore(store.database, dump);
      assert.deepEqual(report.source, { snapshots: 1, runs: 1, results: 2 });
      assert.deepEqual(report.inserted, { snapshots: 1, runs: 1, results: 2 });
      assert.deepEqual(report.reconciled, { snapshots: 1, runs: 1, results: 2 });
      assert.deepEqual(report.mismatches, []);
      assert.equal(report.legacyStore, 'sqlite:synthetic_demo_only');

      // Las APIs de Sprint 01/02 leen el histórico importado como cualquier score propio.
      const latest = await store.scores.latestScores([RESERVATION], 'SYNTHETIC_DEMO_ONLY');
      assert.deepEqual(
        latest
          .get(RESERVATION)
          ?.map((s) => [s.modelKey, s.predictionRunId, s.experimentalRisk?.level]),
        [
          ['random_forest_full_v1', RUN_UID, dump.results[0]?.experimental_level],
          ['xgboost_full_v1', RUN_UID, dump.results[1]?.experimental_level],
        ],
      );
      const byRun = await store.results.findRunResults(RESERVATION, RUN_UID, 'SYNTHETIC_DEMO_ONLY');
      assert.deepEqual(
        byRun.map((s) => s.probabilityNoShow),
        dump.results.map((r) => r.probability_no_show),
      );
      const snapshot = await store.snapshots.findLatestUsable(RESERVATION, 'SYNTHETIC_DEMO_ONLY');
      assert.equal(
        snapshot?.createdAt.toISOString(),
        '2026-10-11T21:00:00.000Z',
        'instante original conservado',
      );

      const admin = await database.connect('admin');
      try {
        const legacy = await admin.query<{ legacy_store: string; legacy_id: string }>(
          'SELECT legacy_store, legacy_id::text FROM ml.app_prediction_model_results ORDER BY legacy_id',
        );
        assert.deepEqual(legacy.rows, [
          { legacy_store: 'sqlite:synthetic_demo_only', legacy_id: '11' },
          { legacy_store: 'sqlite:synthetic_demo_only', legacy_id: '12' },
        ]);
      } finally {
        await admin.end();
      }
    });

    it('re-ejecutar es idempotente (0 INSERT) y un archivo de otro modo se rechaza sin escribir', async () => {
      const again = await importLegacyPredictiveStore(store.database, syntheticDump());
      assert.deepEqual(again.inserted, { snapshots: 0, runs: 0, results: 0 });
      assert.deepEqual(again.alreadyPresent, { snapshots: 1, runs: 1, results: 2 });
      assert.deepEqual(again.mismatches, []);
      await assert.rejects(
        importLegacyPredictiveStore(store.database, {
          ...syntheticDump(),
          dataSourceMode: 'READ_ONLY_EXISTING_SCHEDULE',
        }),
        LegacyImportError,
      );
    });

    it('una fila incoherente aborta TODA la transacción (sin importaciones parciales)', async () => {
      const dump = syntheticDump();
      const broken: LegacyPredictiveStoreDump = {
        ...dump,
        snapshots: [
          {
            ...dump.snapshots[0]!,
            snapshot_id: 8,
            reservation_id: '900000000401002',
            snapshot_hash: 'a'.repeat(64),
          },
        ],
        runs: [
          {
            ...dump.runs[0]!,
            run_id: 4,
            run_uid: '11111111-2222-4333-8444-666666666666',
            snapshot_id: 8,
            reservation_id: '900000000401002',
          },
        ],
        results: [
          {
            ...dump.results[0]!,
            result_id: 13,
            run_id: 4,
            snapshot_id: 8,
            reservation_id: '900000000401002',
            operational_use_allowed: 1,
          },
        ],
      };
      await assert.rejects(importLegacyPredictiveStore(store.database, broken), /uso operativo/);
      assert.equal(
        await store.snapshots.findLatestUsable('900000000401002', 'SYNTHETIC_DEMO_ONLY'),
        null,
      );
    });
  },
);
