import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MlExplanationUnavailableException } from '../../../../../../src/infrastructure/http/ml/errors/MlExplanationUnavailableException.js';
import { GetRiskFactors } from '../../../../../../src/modules/ReservationRisk/GetRiskFactors/application/GetRiskFactors.js';
import { BookingSnapshotResolver } from '../../../../../../src/modules/ReservationRisk/Shared/calculation/BookingSnapshotResolver.js';
import { ExplanationSnapshotUnavailableException } from '../../../../../../src/modules/ReservationRisk/Shared/errors/ExplanationSnapshotUnavailableException.js';
import { FakeBookingEvidenceSource } from '../../../../../helpers/FakeBookingEvidenceSource.js';
import { FakePredictionClient } from '../../../../../helpers/FakePredictionClient.js';
import { InMemoryPredictiveStore } from '../../../../../helpers/InMemoryPredictiveStore.js';
import { InMemoryReservationRepository } from '../../../../../helpers/InMemoryReservationRepository.js';
import {
  makeBookingEvidence,
  makeReservation,
  makeStoredSnapshot,
  SYNTHETIC_RESERVATION_ID,
} from '../../../../../helpers/MakeSyntheticReservation.js';

function setup() {
  const store = new InMemoryPredictiveStore();
  const reservations = new InMemoryReservationRepository(store);
  reservations.add(makeReservation());
  const evidence = new FakeBookingEvidenceSource();
  const ml = new FakePredictionClient();
  const useCase = new GetRiskFactors({
    reservations,
    resolver: new BookingSnapshotResolver(store, evidence, 'READ_ONLY_EXISTING_SCHEDULE'),
    results: store,
    ml,
  });
  const run = (modelKey: 'random_forest_full_v1' | 'xgboost_full_v1', topK = 5) =>
    useCase.execute({
      reservationId: SYNTHETIC_RESERVATION_ID,
      modelKey,
      topK,
      requestId: 'r',
      clinicScope: { kind: 'ALL_CLINICS' },
    });
  return { store, evidence, ml, run };
}

describe('GetRiskFactors (HU-05 SHAP bajo demanda)', () => {
  it('envía a explain EXACTAMENTE las 19 features del snapshot original y no escribe nada', async () => {
    const ctx = setup();
    const snapshot = makeStoredSnapshot();
    ctx.store.addSnapshot(snapshot);
    const result = await ctx.run('random_forest_full_v1');
    const sent = ctx.ml.callsOf('explain')[0]!.request as { features: unknown; top_k: number };
    assert.deepEqual(sent.features, snapshot.features);
    assert.equal(sent.top_k, 5);
    assert.equal(result.explanation.outputSpace, 'probability');
    assert.equal(ctx.store.results.length, 0);
    assert.equal(ctx.store.runs.length, 0);
    assert.equal(ctx.ml.callsOf('predict').length + ctx.ml.callsOf('compare').length, 0);
  });

  it('XGB en log_odds, topK 1/5/10, etiquetas legibles y atributos sensibles marcados', async () => {
    const ctx = setup();
    ctx.store.addSnapshot(makeStoredSnapshot());
    const xgb = await ctx.run('xgboost_full_v1', 1);
    assert.equal(xgb.explanation.outputSpace, 'log_odds');
    assert.equal(xgb.explanation.factors.length, 1);
    const rf = await ctx.run('random_forest_full_v1', 5);
    assert.equal(rf.explanation.factors.length, 5);
    const age = rf.explanation.factors.find((f) => f.featureName === 'age_at_booking');
    assert.equal(age?.label, 'Edad al reservar');
    assert.equal(age?.sensitiveAttribute, true);
    assert.equal(rf.persistedScore.available, false);
  });

  it('sin snapshot original ⇒ EXPLANATION_SNAPSHOT_UNAVAILABLE con motivos (no reconstruye)', async () => {
    const ctx = setup();
    ctx.evidence.add(makeBookingEvidence({ servicesTemporalEvidence: 'NONE_CURRENT_REPLICA' }));
    await assert.rejects(ctx.run('random_forest_full_v1'), ExplanationSnapshotUnavailableException);
    assert.equal(ctx.ml.calls.length, 0);
  });

  it('SHAP no disponible ⇒ error propio y el score persistido queda intacto', async () => {
    const ctx = setup();
    ctx.store.addSnapshot(makeStoredSnapshot());
    ctx.ml.failWith(
      'explain',
      new MlExplanationUnavailableException({
        upstreamCode: 'EXPLANATION_NOT_READY',
        httpStatus: 503,
      }),
    );
    await assert.rejects(ctx.run('random_forest_full_v1'), MlExplanationUnavailableException);
    assert.equal(ctx.store.snapshots.length, 1);
  });
});
