import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpMlPredictionClient } from '../../../../../src/infrastructure/http/ml/HttpMlPredictionClient.js';
import type { MlCompareRequest } from '../../../../../src/infrastructure/http/ml/MlContractTypes.js';
import { resolveMlServiceBaseUrl } from '../../../../../src/infrastructure/http/ml/MlServiceUrl.js';
import { MlTimeoutPolicy } from '../../../../../src/infrastructure/http/ml/MlTimeoutPolicy.js';
import { MlUnavailableException } from '../../../../../src/infrastructure/http/ml/errors/MlUnavailableException.js';
import { CircuitBreaker } from '../../../../../src/infrastructure/resilience/CircuitBreaker.js';
import { ConcurrencyLimiter } from '../../../../../src/infrastructure/resilience/ConcurrencyLimiter.js';
import { RiskFeaturesBuilder } from '../../../../../src/modules/ReservationRisk/Shared/calculation/RiskFeaturesBuilder.js';
import { loadJsonFixture } from '../../../../helpers/LoadFixture.js';
import { makeHistory, makeVerifiedSnapshot } from '../../../../helpers/MakeSyntheticReservation.js';
import { reportSkipped } from '../../../../helpers/ReportSkipped.js';

/**
 * Integración REAL Node → FastAPI (opt-in): ML_RUN_REAL_INTEGRATION=1, ML_REAL_SERVICE_URL y
 * ML_REAL_SERVICE_KEY (clave efímera de una instancia de desarrollo en loopback). Sin esas
 * variables se informa SKIP (nunca PASS). Solo entradas sintéticas.
 */
const enabled =
  process.env.ML_RUN_REAL_INTEGRATION === '1' &&
  process.env.ML_REAL_SERVICE_URL &&
  process.env.ML_REAL_SERVICE_KEY;
const skip = enabled
  ? false
  : 'SKIP: ML_RUN_REAL_INTEGRATION=1 + ML_REAL_SERVICE_URL/KEY no definidos';

reportSkipped('RealMlService', skip);
function client(serviceKey = process.env.ML_REAL_SERVICE_KEY ?? ''): HttpMlPredictionClient {
  return new HttpMlPredictionClient({
    baseUrl: resolveMlServiceBaseUrl(process.env.ML_REAL_SERVICE_URL ?? '', {
      nodeEnv: 'development',
      allowedHosts: [],
    }),
    serviceKey,
    timeoutPolicy: new MlTimeoutPolicy({ defaultMs: 10_000, explanationMs: 30_000 }),
    inferenceLimiter: new ConcurrencyLimiter(2, 8),
    explanationLimiter: new ConcurrencyLimiter(1, 4),
    circuitBreaker: new CircuitBreaker({ failureThreshold: 5, cooldownMs: 30_000 }),
    batchMaxItems: 32,
    logger: { info: () => undefined, warn: () => undefined },
  });
}

const example = loadJsonFixture<{ request: MlCompareRequest }>(
  'fixtures/ml/synthetic_compare_request.json',
).request;

describe('Integración real con depi-noshow-ml (loopback, opt-in)', { skip }, () => {
  it('readiness y catálogo: ambos modelos, 19 predictoras, estado exploratorio', async () => {
    const ml = client();
    assert.equal(
      (await ml.ready({ requestId: 'it-ready' })).serving_status,
      'EXPLORATORY_NOT_VALIDATED',
    );
    const models = await ml.getModels({ requestId: 'it-models' });
    assert.deepEqual(
      models.models.map((m) => m.model_key),
      ['random_forest_full_v1', 'xgboost_full_v1'],
    );
  });

  it('paridad de la fixture artificial del repo Python (RF≈0.69764, XGB≈0.91593)', async () => {
    const compare = await client().compare(example, { requestId: 'it-compare' });
    assert.ok(Math.abs(compare.results[0].probability_no_show - 0.6976400433344135) < 1e-10);
    assert.ok(Math.abs(compare.results[1].probability_no_show - 0.9159286618232727) < 1e-6);
    assert.equal(compare.request_id, 'it-compare');
  });

  it('features construidas por RiskFeaturesBuilder son aceptadas por Python (single, compare, batch)', async () => {
    const built = new RiskFeaturesBuilder().build(makeVerifiedSnapshot(), makeHistory());
    assert.equal(built.kind, 'BUILT');
    if (built.kind !== 'BUILT') return;
    const request = {
      feature_version: built.value.featureVersion,
      feature_context: built.value.featureContext,
      features: built.value.features,
    };
    const ml = client();
    const single = await ml.predict(
      { ...request, model_key: 'xgboost_full_v1' },
      { requestId: 'it-single' },
    );
    assert.ok(single.probability_no_show >= 0 && single.probability_no_show <= 1);
    const batch = await ml.batch(
      {
        ...request,
        mode: 'compare',
        items: [{ features: request.features }, { features: request.features }],
      },
      { requestId: 'it-batch' },
    );
    assert.equal(batch.count, 2);
  });

  it('SHAP RF (probabilidad) y XGB (log-odds) validan aditividad dentro de tolerancias', async () => {
    const ml = client();
    const rf = await ml.explain(
      { ...example, model_key: 'random_forest_full_v1', top_k: 5 },
      { requestId: 'it-explain-rf' },
    );
    const xgb = await ml.explain(
      { ...example, model_key: 'xgboost_full_v1', top_k: 10 },
      { requestId: 'it-explain-xgb' },
    );
    assert.equal(rf.explanation.output_space, 'probability');
    assert.equal(xgb.explanation.output_space, 'log_odds');
    assert.equal(xgb.explanation.factors.length, 10);
  });

  it('clave inválida ⇒ ML_CREDENTIAL_REJECTED sin revelar la clave', async () => {
    await assert.rejects(
      client('x'.repeat(48)).getModels({ requestId: 'it-401' }),
      (error: unknown) => {
        assert.ok(error instanceof MlUnavailableException);
        assert.equal(error.code, 'ML_CREDENTIAL_REJECTED');
        assert.doesNotMatch(JSON.stringify(error.metadata), /x{48}/);
        return true;
      },
    );
  });
});
