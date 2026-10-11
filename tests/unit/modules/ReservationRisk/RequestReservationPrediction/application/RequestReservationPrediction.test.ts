import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { CachedMlModelCatalog } from '../../../../../../src/infrastructure/http/ml/CachedMlModelCatalog.js';
import { MlTimeoutException } from '../../../../../../src/infrastructure/http/ml/errors/MlTimeoutException.js';
import { MlUnavailableException } from '../../../../../../src/infrastructure/http/ml/errors/MlUnavailableException.js';
import { PersistenceUnavailableException } from '../../../../../../src/infrastructure/database/errors/PersistenceUnavailableException.js';
import { RequestReservationPrediction } from '../../../../../../src/modules/ReservationRisk/RequestReservationPrediction/application/RequestReservationPrediction.js';
import { BookingSnapshotResolver } from '../../../../../../src/modules/ReservationRisk/Shared/calculation/BookingSnapshotResolver.js';
import { RiskFeaturesBuilder } from '../../../../../../src/modules/ReservationRisk/Shared/calculation/RiskFeaturesBuilder.js';
import { InvalidFeatureSnapshotException } from '../../../../../../src/modules/ReservationRisk/Shared/errors/InvalidFeatureSnapshotException.js';
import { NotScorableException } from '../../../../../../src/modules/ReservationRisk/Shared/errors/NotScorableException.js';
import { PendingValidationRiskLevelPolicy } from '../../../../../../src/modules/ReservationRisk/Shared/policy/PendingValidationRiskLevelPolicy.js';
import { ReservationNotFoundException } from '../../../../../../src/modules/Reservations/Shared/errors/ReservationNotFoundException.js';
import type { DataSourceMode } from '../../../../../../src/shared/data/DataSourceMode.js';
import { FakeBookingEvidenceSource } from '../../../../../helpers/FakeBookingEvidenceSource.js';
import { FakePredictionClient } from '../../../../../helpers/FakePredictionClient.js';
import { FixedClock } from '../../../../../helpers/FixedClock.js';
import { InMemoryClientHistoryRepository } from '../../../../../helpers/InMemoryClientHistoryRepository.js';
import { InMemoryPredictiveStore } from '../../../../../helpers/InMemoryPredictiveStore.js';
import { InMemoryReservationRepository } from '../../../../../helpers/InMemoryReservationRepository.js';
import {
  makeBookingEvidence,
  makeReservation,
  makeStoredSnapshot,
  SYNTHETIC_CLIENT_ID,
  SYNTHETIC_RESERVATION_ID,
} from '../../../../../helpers/MakeSyntheticReservation.js';

const ALL = { kind: 'ALL_CLINICS' } as const;

function setup(
  options: {
    mode?: DataSourceMode;
    evidence?: FakeBookingEvidenceSource;
    catalogTtlMs?: number;
  } = {},
) {
  const store = new InMemoryPredictiveStore();
  const reservations = new InMemoryReservationRepository(store);
  const history = new InMemoryClientHistoryRepository();
  const evidence = options.evidence ?? new FakeBookingEvidenceSource('CAPTURED_AT_BOOKING');
  const ml = new FakePredictionClient();
  const mode = options.mode ?? 'READ_ONLY_EXISTING_SCHEDULE';
  reservations.add(makeReservation());
  const useCase = new RequestReservationPrediction({
    reservations,
    resolver: new BookingSnapshotResolver(store, evidence, mode),
    history,
    builder: new RiskFeaturesBuilder(),
    snapshots: store,
    results: store,
    ml,
    modelCatalog: new CachedMlModelCatalog(ml, options.catalogTtlMs ?? 60_000),
    policy: new PendingValidationRiskLevelPolicy(),
    mode,
    clock: new FixedClock(new Date('2026-10-25T15:00:00Z')),
  });
  const execute = (
    prediction:
      | { mode: 'compare' }
      | { mode: 'single'; modelKey: 'random_forest_full_v1' | 'xgboost_full_v1' } = {
      mode: 'compare',
    },
  ) =>
    useCase.execute({
      reservationId: SYNTHETIC_RESERVATION_ID,
      prediction,
      requestId: 'req-1',
      clinicScope: ALL,
    });
  return { store, reservations, history, evidence, ml, execute };
}

describe('RequestReservationPrediction (HU-02 acción explícita e idempotente)', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('snapshot verificado ⇒ crea snapshot, llama compare UNA vez y persiste RF y XGB con identidad', async () => {
    ctx.evidence.add(makeBookingEvidence());
    ctx.history.add({
      clientId: SYNTHETIC_CLIENT_ID,
      appointmentId: '1',
      knownAt: new Date('2026-01-10Z'),
      kind: 0,
    });
    const result = await ctx.execute();

    assert.equal(result.run.snapshotCreated, true);
    assert.equal(result.run.replayed, false);
    assert.ok(result.run.predictionRunId);
    assert.equal(ctx.ml.callsOf('compare').length, 1);
    assert.equal(ctx.store.snapshots.length, 1);
    assert.equal(ctx.store.results.length, 2);
    assert.deepEqual(
      result.assessment.models.map((m) => [m.modelKey, m.modelHash]),
      [
        ['random_forest_full_v1', '4e3c86a17005'],
        ['xgboost_full_v1', '376d3db9d4d3'],
      ],
    );
    assert.ok(
      result.assessment.models.every(
        (m) => m.riskLevel === null && m.operationalUseAllowed === false,
      ),
    );
    assert.equal(result.assessment.status, 'AVAILABLE_EXPLORATORY');

    // Las features enviadas son exactamente las del snapshot persistido (con historial as-of).
    const sent = ctx.ml.callsOf('compare')[0]!.request as { features: Record<string, unknown> };
    assert.deepEqual(sent.features, ctx.store.snapshots[0]!.features);
    assert.equal(sent.features.previous_attended, 1);
  });

  it('segunda petición idéntica ⇒ reutiliza resultados, NO llama a Python ni duplica registros', async () => {
    ctx.evidence.add(makeBookingEvidence());
    await ctx.execute();
    const replay = await ctx.execute();
    assert.equal(replay.run.replayed, true);
    assert.equal(replay.run.predictionRunId, null);
    assert.equal(ctx.ml.callsOf('compare').length, 1);
    assert.equal(ctx.store.results.length, 2);
    assert.equal(ctx.store.runs.length, 1);
  });

  it('single tras compare no reinfiere; compare tras single solo infiere el modelo faltante', async () => {
    ctx.evidence.add(makeBookingEvidence());
    await ctx.execute({ mode: 'single', modelKey: 'random_forest_full_v1' });
    assert.equal(ctx.ml.callsOf('predict').length, 1);
    const compare = await ctx.execute({ mode: 'compare' });
    assert.equal(ctx.ml.callsOf('compare').length, 0);
    assert.equal(ctx.ml.callsOf('predict').length, 2);
    assert.deepEqual(
      (ctx.ml.callsOf('predict')[1]!.request as { model_key: string }).model_key,
      'xgboost_full_v1',
    );
    assert.equal(compare.assessment.models.length, 2);
    assert.ok(compare.assessment.comparison);
  });

  it('snapshot almacenado se reutiliza aunque la fuente cambie después (no se reescribe)', async () => {
    const stored = makeStoredSnapshot({ snapshotId: '77' });
    ctx.store.addSnapshot(stored);
    ctx.evidence.add(makeBookingEvidence({ services: [] }));
    const result = await ctx.execute();
    assert.equal(result.run.snapshotCreated, false);
    assert.equal(ctx.evidence.loads, 0);
    assert.equal(ctx.store.snapshots.length, 1);
    assert.equal(ctx.store.results[0]!.snapshotId, '77');
  });

  it('sin evidencia temporal (réplica actual) ⇒ NOT_SCORABLE y cero llamadas a Python', async () => {
    const real = setup({ evidence: new FakeBookingEvidenceSource('NONE_CURRENT_REPLICA') });
    real.evidence.add(makeBookingEvidence({ servicesTemporalEvidence: 'NONE_CURRENT_REPLICA' }));
    await assert.rejects(real.execute(), (error: unknown) => {
      assert.ok(error instanceof NotScorableException);
      assert.deepEqual(
        error.reasons.map((r) => r.code),
        ['SCHEDULED_SERVICES_NOT_POINT_IN_TIME'],
      );
      return true;
    });
    assert.equal(real.ml.calls.length, 0);
    assert.equal(real.store.snapshots.length, 0);
  });

  it('predictoras incoherentes desde la fuente ⇒ 422 INVALID_FEATURES sin llamar a Python ni persistir', async () => {
    ctx.evidence.add(makeBookingEvidence({ clinicId: Number('9007199254740993') }));
    await assert.rejects(ctx.execute(), (error: unknown) => {
      assert.ok(error instanceof InvalidFeatureSnapshotException);
      assert.deepEqual(error.issues, [{ field: 'clinic_id', reason: 'not_safe_integer' }]);
      return true;
    });
    assert.equal(ctx.ml.calls.length, 0);
    assert.equal(ctx.store.snapshots.length, 0);
  });

  it('reserva cancelada/pasada ⇒ NOT_SCORABLE; inexistente ⇒ 404', async () => {
    ctx.reservations.add(makeReservation({ status: 'CANCELLED' }));
    await assert.rejects(ctx.execute(), NotScorableException);
    ctx.reservations.reservations.clear();
    await assert.rejects(ctx.execute(), ReservationNotFoundException);
  });

  it('modo sintético sin snapshot sintético ⇒ NOT_SCORABLE sin leer fuentes reales', async () => {
    const synthetic = setup({ mode: 'SYNTHETIC_DEMO_ONLY' });
    synthetic.evidence.add(makeBookingEvidence());
    await assert.rejects(
      synthetic.execute(),
      (e: unknown) =>
        e instanceof NotScorableException && e.reasons[0]?.code === 'NO_USABLE_SNAPSHOT_IN_MODE',
    );
    assert.equal(synthetic.evidence.loads, 0);
  });

  it('fallo/timeout de Python ⇒ error propagado, nada persistido, nunca score 0', async () => {
    ctx.evidence.add(makeBookingEvidence());
    ctx.ml.failWith('compare', new MlTimeoutException({ operation: 'compare', timeoutMs: 5 }));
    await assert.rejects(ctx.execute(), MlTimeoutException);
    assert.equal(ctx.store.results.length, 0);
    assert.equal(ctx.store.runs.length, 0);

    ctx.ml.failWith(
      'compare',
      new MlUnavailableException({ code: 'ML_UNAVAILABLE', operation: 'compare' }),
    );
    await assert.rejects(ctx.execute(), MlUnavailableException);
    assert.equal(ctx.store.results.length, 0);
  });

  it('fallo de persistencia ⇒ sin resultado parcial; el reintento posterior sí persiste', async () => {
    ctx.evidence.add(makeBookingEvidence());
    ctx.store.failNextSaveRun = new PersistenceUnavailableException({
      operation: 'SavePredictionRun',
    });
    await assert.rejects(ctx.execute(), PersistenceUnavailableException);
    assert.equal(ctx.store.results.length, 0);
    const retry = await ctx.execute();
    assert.equal(retry.run.replayed, false);
    assert.equal(ctx.store.results.length, 2);
  });

  it('cambio de release del modelo ⇒ nuevo registro con la identidad devuelta, sin pisar el anterior', async () => {
    const live = setup({ catalogTtlMs: 0 });
    live.evidence.add(makeBookingEvidence());
    await live.execute({ mode: 'single', modelKey: 'random_forest_full_v1' });
    const firstResult = { ...live.store.results[0]! };

    const newVersion = 'random_forest_full_v1:ffffffffffff';
    const getModels = live.ml.getModels.bind(live.ml);
    const predict = live.ml.predict.bind(live.ml);
    live.ml.getModels = async (context) => {
      const catalog = await getModels(context);
      catalog.models[0].model_version = newVersion;
      catalog.models[0].model_hash = 'ffffffffffff';
      return catalog;
    };
    live.ml.predict = async (request, context) => ({
      ...(await predict(request, context)),
      model_version: newVersion,
      model_hash: 'ffffffffffff',
    });

    const result = await live.execute({ mode: 'single', modelKey: 'random_forest_full_v1' });
    assert.equal(result.run.replayed, false);
    assert.equal(live.store.results.length, 2);
    assert.deepEqual(live.store.results[0], firstResult, 'el registro anterior no se modifica');
    assert.equal(result.assessment.models[0]!.modelVersion, newVersion);
  });
});
