import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { MlContractViolationException } from '../../../src/infrastructure/http/ml/errors/MlContractViolationException.js';
import { MlRateLimitedException } from '../../../src/infrastructure/http/ml/errors/MlRateLimitedException.js';
import { MlTimeoutException } from '../../../src/infrastructure/http/ml/errors/MlTimeoutException.js';
import { MlUnavailableException } from '../../../src/infrastructure/http/ml/errors/MlUnavailableException.js';
import { MlFeatureVersionMismatchException } from '../../../src/infrastructure/http/ml/errors/MlFeatureVersionMismatchException.js';
import { AUTH_HEADERS, buildTestApp, type TestAppContext } from '../../helpers/BuildTestApp.js';
import { FakeBookingEvidenceSource } from '../../helpers/FakeBookingEvidenceSource.js';
import {
  makeBookingEvidence,
  makeReservation,
  SYNTHETIC_RESERVATION_ID,
} from '../../helpers/MakeSyntheticReservation.js';

let ctx: TestAppContext;
afterEach(async () => ctx?.app.close());

const RISK_URL = `/api/v1/reservations/${SYNTHETIC_RESERVATION_ID}/risk`;
const PREDICT_URL = `/api/v1/reservations/${SYNTHETIC_RESERVATION_ID}/predictions`;

function verifiedContext(): TestAppContext {
  const context = buildTestApp({ evidence: new FakeBookingEvidenceSource('CAPTURED_AT_BOOKING') });
  context.reservations.add(makeReservation());
  context.evidence.add(makeBookingEvidence());
  return context;
}

const post = (payload: unknown) =>
  ctx.app.inject({
    method: 'POST',
    url: PREDICT_URL,
    headers: AUTH_HEADERS,
    payload: payload as object,
  });

describe('HU-02: GET /risk (lectura) y POST /predictions (acción explícita)', () => {
  it('GET /risk nunca llama a Python ni crea snapshots (sin HU-04 encubierta)', async () => {
    ctx = verifiedContext();
    const first = await ctx.app.inject({ method: 'GET', url: RISK_URL, headers: AUTH_HEADERS });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().data.status, 'NOT_SCORED');
    assert.equal(ctx.ml.calls.length, 0);
    assert.equal(ctx.store.snapshots.length, 0);
  });

  it('POST compare ⇒ 201 con RF y XGB, porcentaje = 100·p exacto, identidad y estados no operativos', async () => {
    ctx = verifiedContext();
    const response = await post({ mode: 'compare' });
    assert.equal(response.statusCode, 201);
    const data = response.json().data;
    assert.equal(data.status, 'AVAILABLE_EXPLORATORY');
    assert.equal(data.run.replayed, false);
    assert.deepEqual(
      data.models.map((m: { modelKey: string }) => m.modelKey),
      ['random_forest_full_v1', 'xgboost_full_v1'],
    );
    for (const model of data.models) {
      assert.equal(model.percentageNoShow, model.probabilityNoShow * 100);
      assert.equal(model.operationalUseAllowed, false);
      assert.equal(model.riskLevel, null);
      assert.equal(model.target, 'NO_SHOW_CANDIDATE');
      assert.equal(model.validationStatus, 'EXPLORATORY_NOT_VALIDATED');
      assert.match(model.modelHash, /^[0-9a-f]{12}$/);
    }
    assert.equal(data.models[0].probabilityNoShow, 0.6976400433344135);
    assert.equal(data.comparison.ensembleProbability, null);
    assert.equal(data.comparison.selectedWinner, null);
    assert.equal(data.comparison.interpretation, 'descriptive_only_not_model_confidence');
    assert.equal(data.riskLevel, null);
    assert.equal(data.riskPolicyStatus, 'pending_validation');
    assert.equal(data.snapshot.snapshotType, 'booking_creation');
    assert.equal(data.snapshot.snapshotHash.length, 16);

    const replay = await post({ mode: 'compare' });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().data.run.replayed, true);
    assert.equal(ctx.ml.callsOf('compare').length, 1);

    const risk = (
      await ctx.app.inject({ method: 'GET', url: RISK_URL, headers: AUTH_HEADERS })
    ).json().data;
    assert.equal(risk.status, 'AVAILABLE_EXPLORATORY');
    assert.equal(risk.models.length, 2);
  });

  it('cuerpo: single exige modelKey; compare lo prohíbe; modelos desconocidos ⇒ 400', async () => {
    ctx = verifiedContext();
    for (const body of [
      { mode: 'single' },
      { mode: 'compare', modelKey: 'random_forest_full_v1' },
      { mode: 'single', modelKey: 'lightgbm' },
      {},
      { mode: 'ensemble' },
    ]) {
      assert.equal((await post(body)).statusCode, 400, JSON.stringify(body));
    }
    const single = await post({ mode: 'single', modelKey: 'xgboost_full_v1' });
    assert.equal(single.statusCode, 201);
    assert.deepEqual(
      single.json().data.models.map((m: { modelKey: string }) => m.modelKey),
      ['xgboost_full_v1'],
    );
    assert.equal(single.json().data.comparison, null);
  });

  it('snapshot no demostrable ⇒ 409 NOT_SCORABLE con motivos y cero inferencias', async () => {
    ctx = buildTestApp();
    ctx.reservations.add(makeReservation());
    ctx.evidence.add(
      makeBookingEvidence({
        servicesTemporalEvidence: 'NONE_CURRENT_REPLICA',
        hasRescheduleEvent: true,
      }),
    );
    const response = await post({ mode: 'compare' });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, 'NOT_SCORABLE');
    assert.deepEqual(
      response.json().error.details.reasons.map((r: { code: string }) => r.code),
      ['RESCHEDULED_WITHOUT_ORIGINAL_SNAPSHOT', 'SCHEDULED_SERVICES_NOT_POINT_IN_TIME'],
    );
    assert.equal(ctx.ml.calls.length, 0);
    const risk = (
      await ctx.app.inject({ method: 'GET', url: RISK_URL, headers: AUTH_HEADERS })
    ).json().data;
    assert.equal(risk.status, 'NOT_SCORABLE');
    assert.equal(risk.models.length, 0);
  });

  it('errores del servicio ML se traducen a 429/503/504/502/409 y nunca a probabilidad 0', async () => {
    const cases: Array<[Error, number, string]> = [
      [
        new MlRateLimitedException({ operation: 'compare', origin: 'ML_SERVICE' }),
        429,
        'ML_RATE_LIMITED',
      ],
      [
        new MlUnavailableException({ code: 'ML_UNAVAILABLE', operation: 'compare' }),
        503,
        'ML_UNAVAILABLE',
      ],
      [
        new MlUnavailableException({ code: 'ML_CREDENTIAL_REJECTED', operation: 'compare' }),
        503,
        'ML_CREDENTIAL_REJECTED',
      ],
      [new MlTimeoutException({ operation: 'compare', timeoutMs: 5000 }), 504, 'ML_TIMEOUT'],
      [new MlContractViolationException({ operation: 'compare' }), 502, 'ML_CONTRACT_VIOLATION'],
      [
        new MlFeatureVersionMismatchException({ operation: 'compare' }),
        409,
        'FEATURE_VERSION_MISMATCH',
      ],
    ];
    for (const [error, status, code] of cases) {
      ctx = verifiedContext();
      ctx.ml.failWith('compare', error);
      const response = await post({ mode: 'compare' });
      assert.deepEqual([response.statusCode, response.json().error.code], [status, code], code);
      assert.equal(ctx.store.results.length, 0);
      assert.doesNotMatch(response.body, /probabilityNoShow/);
      await ctx.app.close();
    }
  });
});
