import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { MlUnavailableException } from '../../../src/infrastructure/http/ml/errors/MlUnavailableException.js';
import { AUTH_HEADERS, buildTestApp, type TestAppContext } from '../../helpers/BuildTestApp.js';

let ctx: TestAppContext;
afterEach(async () => ctx?.app.close());

describe('GET /api/v1/health/ml y /api/v1/ml/models', () => {
  it('health ML acotado: sin claves ni rutas de modelos; 503 si Python no está listo', async () => {
    ctx = buildTestApp();
    const ok = await ctx.app.inject({ method: 'GET', url: '/api/v1/health/ml' });
    assert.deepEqual(Object.keys(ok.json()).sort(), [
      'message',
      'operationalUseAllowed',
      'service',
      'servingStatus',
      'status',
    ]);
    ctx.ml.failWith(
      'ready',
      new MlUnavailableException({ code: 'ML_UNAVAILABLE', operation: 'ready' }),
    );
    assert.equal(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/health/ml' })).statusCode,
      503,
    );
  });

  it('catálogo de modelos con identidad pública y estado exploratorio (requiere credencial)', async () => {
    ctx = buildTestApp();
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/ml/models',
      headers: AUTH_HEADERS,
    });
    const data = response.json().data;
    assert.equal(data.featureVersion, 'BOOKING_BASELINE_V1');
    assert.deepEqual(
      data.models.map((m: { modelHash: string }) => m.modelHash),
      ['4e3c86a17005', '376d3db9d4d3'],
    );
    assert.ok(
      data.models.every(
        (m: { operationalUseAllowed: boolean }) => m.operationalUseAllowed === false,
      ),
    );
    assert.equal(data.riskPolicyStatus, 'pending_validation');
    assert.doesNotMatch(response.body, /predictor_columns|manifest|\.joblib/);
  });
});
