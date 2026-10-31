import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { AUTH_HEADERS, buildTestApp } from '../../helpers/BuildTestApp.js';
import {
  makeReservation,
  makeStoredSnapshot,
  makeVerifiedSnapshot,
  SYNTHETIC_CLIENT_ID,
  SYNTHETIC_RESERVATION_ID,
} from '../../helpers/MakeSyntheticReservation.js';

/**
 * Flujo E2E Sprint 01 en modo SYNTHETIC_DEMO_ONLY: listado → detalle → predicción compare →
 * riesgo → factores SHAP → historial. Todo con datos artificiales y Python simulado (goldens).
 */
describe('Flujo Sprint 01 (SYNTHETIC_DEMO_ONLY, Python simulado)', () => {
  const ctx = buildTestApp({ mode: 'SYNTHETIC_DEMO_ONLY' });
  after(async () => ctx.app.close());

  ctx.reservations.add(
    makeReservation(),
    makeReservation({
      reservationId: '900000000001002',
      appointmentAt: new Date('2026-11-13T15:00:00Z'),
    }),
  );
  ctx.store.addSnapshot(
    makeStoredSnapshot({
      verified: makeVerifiedSnapshot({ evidenceSource: 'SYNTHETIC_DEMO_ONLY' }),
      evidenceSource: 'SYNTHETIC_DEMO_ONLY',
    }),
  );
  ctx.history.add({
    clientId: SYNTHETIC_CLIENT_ID,
    appointmentId: '1',
    knownAt: new Date('2026-08-01Z'),
    kind: 1,
  });

  const get = (url: string) => ctx.app.inject({ method: 'GET', url, headers: AUTH_HEADERS });

  it('recorre las 5 HU activas sin fabricar niveles ni usar datos futuros', async () => {
    const before = (await get('/api/v1/reservations?from=2026-11-01&to=2026-11-30')).json();
    assert.equal(before.sourceStatus, 'SYNTHETIC_DEMO_ONLY');
    assert.deepEqual(
      before.data.map(
        (d: { risk: { predictionAvailability: string } }) => d.risk.predictionAvailability,
      ),
      ['NOT_SCORED', 'NOT_SCORABLE'],
    );

    const detail = (await get(`/api/v1/reservations/${SYNTHETIC_RESERVATION_ID}`)).json().data;
    assert.equal(detail.hasUsableSnapshot, true);

    const predicted = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/reservations/${SYNTHETIC_RESERVATION_ID}/predictions`,
      headers: AUTH_HEADERS,
      payload: { mode: 'compare' },
    });
    assert.equal(predicted.statusCode, 201);
    assert.equal(predicted.json().data.snapshot.evidenceSource, 'SYNTHETIC_DEMO_ONLY');

    const sorted = (
      await get(
        '/api/v1/reservations?from=2026-11-01&to=2026-11-30&sort=probabilityNoShow&direction=desc',
      )
    ).json();
    assert.equal(sorted.sort.semantics, 'EXPLORATORY_SCORE_ORDER');
    assert.equal(sorted.data[0].reservationId, SYNTHETIC_RESERVATION_ID);
    assert.equal(sorted.data[0].risk.probabilities.length, 2);
    assert.equal(
      sorted.data[1].risk.probabilities.length,
      0,
      'no evaluada ⇒ null al final, nunca 0',
    );

    const risk = (await get(`/api/v1/reservations/${SYNTHETIC_RESERVATION_ID}/risk`)).json().data;
    assert.equal(risk.status, 'AVAILABLE_EXPLORATORY');
    assert.equal(risk.riskLevel, null);

    const factors = (
      await get(
        `/api/v1/reservations/${SYNTHETIC_RESERVATION_ID}/risk/factors?modelKey=xgboost_full_v1&topK=10`,
      )
    ).json().data;
    assert.equal(factors.explanation.outputSpace, 'log_odds');
    assert.equal(factors.persistedScore.sameModelIdentity, true);

    const historyData = (
      await get(`/api/v1/reservations/${SYNTHETIC_RESERVATION_ID}/client-history`)
    ).json().data;
    assert.equal(historyData.previousNoShow, 1);
    // El historial mostrado usa el mismo corte que la predicción (creación de la reserva).
    assert.equal(historyData.cutoffAt, risk.snapshot.predictionAt);
    assert.equal(ctx.ml.callsOf('compare').length, 1);
    assert.equal(ctx.ml.callsOf('explain').length, 1);
  });
});
