import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { MlExplanationUnavailableException } from '../../../src/infrastructure/http/ml/errors/MlExplanationUnavailableException.js';
import { AUTH_HEADERS, buildTestApp, type TestAppContext } from '../../helpers/BuildTestApp.js';
import { FakeBookingEvidenceSource } from '../../helpers/FakeBookingEvidenceSource.js';
import {
  makeBookingEvidence,
  makeReservation,
  SYNTHETIC_RESERVATION_ID,
} from '../../helpers/MakeSyntheticReservation.js';

let ctx: TestAppContext;
afterEach(async () => ctx?.app.close());

const factors = (query = '') =>
  ctx.app.inject({
    method: 'GET',
    url: `/api/v1/reservations/${SYNTHETIC_RESERVATION_ID}/risk/factors${query}`,
    headers: AUTH_HEADERS,
  });

async function scoredContext(): Promise<TestAppContext> {
  const context = buildTestApp({ evidence: new FakeBookingEvidenceSource('CAPTURED_AT_BOOKING') });
  context.reservations.add(makeReservation());
  context.evidence.add(makeBookingEvidence());
  await context.app.inject({
    method: 'POST',
    url: `/api/v1/reservations/${SYNTHETIC_RESERVATION_ID}/predictions`,
    headers: AUTH_HEADERS,
    payload: { mode: 'compare' },
  });
  return context;
}

describe('HU-05: GET /risk/factors (SHAP bajo demanda, no causal)', () => {
  it('RF en probabilidad y XGB en log-odds, con unidades, identidad y correlación con el score persistido', async () => {
    ctx = await scoredContext();
    const rf = (await factors('?modelKey=random_forest_full_v1&topK=5')).json().data;
    assert.equal(rf.explanation.outputSpace, 'probability');
    assert.equal(rf.explanation.factors.length, 5);
    assert.equal(rf.persistedScore.sameModelIdentity, true);
    assert.equal(rf.persistedScore.probabilityNoShow, rf.probabilityNoShow);
    assert.equal(rf.interpretation.scope, 'local_association_not_causality');
    assert.match(rf.interpretation.note, /no son causas/);
    assert.equal(rf.riskLevel, null);
    const absolutes = rf.explanation.factors.map(
      (f: { absoluteContribution: number }) => f.absoluteContribution,
    );
    assert.deepEqual(
      absolutes,
      [...absolutes].sort((a: number, b: number) => b - a),
    );

    const xgb = (await factors('?modelKey=xgboost_full_v1&topK=1')).json().data;
    assert.equal(xgb.explanation.outputSpace, 'log_odds');
    assert.equal(xgb.explanation.outputLink, 'sigmoid');
    assert.match(xgb.explanation.units, /NO son puntos porcentuales/);
    assert.equal(xgb.explanation.factors.length, 1);

    const resultsBefore = ctx.store.results.length;
    await factors();
    assert.equal(ctx.store.results.length, resultsBefore, 'GET factors no escribe');
    assert.equal(ctx.ml.callsOf('compare').length, 1, 'ni reinfiere');
  });

  it('topK fuera de 1..10 o modelo desconocido ⇒ 400; sin snapshot ⇒ 409', async () => {
    ctx = await scoredContext();
    for (const query of ['?topK=0', '?topK=11', '?modelKey=random_forest', '?topK=abc']) {
      assert.equal((await factors(query)).statusCode, 400, query);
    }
    await ctx.app.close();
    ctx = buildTestApp();
    ctx.reservations.add(makeReservation());
    ctx.evidence.add(makeBookingEvidence({ servicesTemporalEvidence: 'NONE_CURRENT_REPLICA' }));
    const response = await factors();
    assert.deepEqual(
      [response.statusCode, response.json().error.code],
      [409, 'EXPLANATION_SNAPSHOT_UNAVAILABLE'],
    );
  });

  it('SHAP no disponible ⇒ 503 EXPLANATION_UNAVAILABLE y el score previo sigue disponible', async () => {
    ctx = await scoredContext();
    ctx.ml.failWith(
      'explain',
      new MlExplanationUnavailableException({
        upstreamCode: 'EXPLANATION_NOT_READY',
        httpStatus: 503,
      }),
    );
    const response = await factors();
    assert.deepEqual(
      [response.statusCode, response.json().error.code],
      [503, 'EXPLANATION_UNAVAILABLE'],
    );
    const risk = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/reservations/${SYNTHETIC_RESERVATION_ID}/risk`,
      headers: AUTH_HEADERS,
    });
    assert.equal(risk.json().data.status, 'AVAILABLE_EXPLORATORY');
  });
});
