import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CachedResearchPolicyCatalog } from '../../../../../src/infrastructure/http/ml/CachedResearchPolicyCatalog.js';
import { HttpMlPredictionClient } from '../../../../../src/infrastructure/http/ml/HttpMlPredictionClient.js';
import type { MlCompareRequest } from '../../../../../src/infrastructure/http/ml/MlContractTypes.js';
import { assertScoreMatchesPolicy } from '../../../../../src/infrastructure/http/ml/MlResearchContractValidator.js';
import { resolveMlServiceBaseUrl } from '../../../../../src/infrastructure/http/ml/MlServiceUrl.js';
import { MlTimeoutPolicy } from '../../../../../src/infrastructure/http/ml/MlTimeoutPolicy.js';
import { MlFeatureVersionMismatchException } from '../../../../../src/infrastructure/http/ml/errors/MlFeatureVersionMismatchException.js';
import { MlUnavailableException } from '../../../../../src/infrastructure/http/ml/errors/MlUnavailableException.js';
import { CircuitBreaker } from '../../../../../src/infrastructure/resilience/CircuitBreaker.js';
import { ConcurrencyLimiter } from '../../../../../src/infrastructure/resilience/ConcurrencyLimiter.js';
import { loadJsonFixture } from '../../../../helpers/LoadFixture.js';
import { reportSkipped } from '../../../../helpers/ReportSkipped.js';

/**
 * Integración REAL Node → FastAPI research v2 (opt-in, mismas variables que RealMlService):
 * ML_RUN_REAL_INTEGRATION=1, ML_REAL_SERVICE_URL, ML_REAL_SERVICE_KEY. Solo entradas sintéticas.
 */
const enabled =
  process.env.ML_RUN_REAL_INTEGRATION === '1' &&
  process.env.ML_REAL_SERVICE_URL &&
  process.env.ML_REAL_SERVICE_KEY;
const skip = enabled
  ? false
  : 'SKIP: ML_RUN_REAL_INTEGRATION=1 + ML_REAL_SERVICE_URL/KEY no definidos';
reportSkipped('RealMlResearchService', skip);

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
const { cases } = loadJsonFixture<{
  cases: Array<{
    name: string;
    request: MlCompareRequest;
    expected_levels: Record<string, string>;
  }>;
}>('fixtures/ml/golden_v2_band_cases.json');

describe('Integración real research v2 con depi-noshow-ml (loopback, opt-in)', { skip }, () => {
  it('GET /internal/v2/risk-policy: RESEARCH_PROVISIONAL con los hashes exactos publicados', async () => {
    const catalog = await client().getResearchPolicy({ requestId: 'it-v2-policy' });
    assert.equal(catalog.available, true);
    assert.equal(catalog.status, 'RESEARCH_PROVISIONAL');
    assert.equal(catalog.reason, null);
    const byModel = Object.fromEntries(catalog.policies.map((p) => [p.model_key, p]));
    assert.equal(
      byModel.random_forest_full_v1?.policy_hash,
      '1d58ce962e899b758275f7191244225e8c970cf2db9661ffcb21be9b63a4ce74',
    );
    assert.equal(
      byModel.xgboost_full_v1?.policy_hash,
      '208c706d839b7c8b71134cd225da4bc1bb935c5d4bd06cbb898a8d8f84ee7032',
    );
    assert.equal(
      byModel.random_forest_full_v1?.model_version,
      'random_forest_full_v1:4e3c86a17005',
    );
    assert.equal(byModel.xgboost_full_v1?.model_version, 'xgboost_full_v1:376d3db9d4d3');
    for (const policy of catalog.policies) {
      assert.equal(policy.policy_version, 'research_risk_v1_1');
      assert.equal(policy.approved_by, null);
      assert.equal(policy.operational_use_allowed, false);
    }
  });

  it('compare v2 con examples/prediction_compare.json: paridad con la verificación manual', async () => {
    const ml = client();
    const response = await ml.compareResearch(example, { requestId: 'it-v2-compare' });
    const [rf, xgb] = response.results;
    assert.ok(Math.abs(rf.probability_no_show - 0.6976400433344135) <= 1e-12);
    assert.equal(xgb.probability_no_show, 0.9159286618232727);
    assert.ok(
      Math.abs(response.comparison.absolute_probability_difference - 0.21828861848885917) <= 1e-12,
    );
    assert.deepEqual([rf.experimental_risk.level, xgb.experimental_risk.level], ['HIGH', 'HIGH']);
    assert.equal(response.comparison.selected_winner, null);
    assert.equal(response.comparison.ensemble_probability, null);
    assert.equal(response.risk_level, null);
    const policies = await new CachedResearchPolicyCatalog(ml, {
      ttlMs: 1000,
      expectedPolicyHashes: [],
    }).requirePolicies({ requestId: 'it-v2-cat' });
    for (const score of response.results) {
      assertScoreMatchesPolicy(score, policies.get(score.model_key)!, 'research_compare');
    }
  });

  it('single v2 RF y XGB devuelven score + experimentalRisk de su propio modelo', async () => {
    const ml = client();
    const rf = await ml.predictResearch(
      { ...example, model_key: 'random_forest_full_v1' },
      { requestId: 'it-v2-rf' },
    );
    const xgb = await ml.predictResearch(
      { ...example, model_key: 'xgboost_full_v1' },
      { requestId: 'it-v2-xgb' },
    );
    assert.equal(rf.experimental_risk.policy_id, 'random_forest_full_v1_tertiles_202604_202605');
    assert.equal(xgb.experimental_risk.policy_id, 'xgboost_full_v1_tertiles_202604_202605');
    assert.equal(rf.probability_no_show_percent, rf.probability_no_show * 100);
  });

  it('los 4 casos sintéticos de Python reproducen LOW/MEDIUM/HIGH esperados en ambos modelos', async () => {
    const ml = client();
    for (const testCase of cases) {
      const response = await ml.compareResearch(testCase.request, {
        requestId: `it-v2-${testCase.name}`,
      });
      for (const score of response.results) {
        assert.equal(
          score.experimental_risk.level,
          testCase.expected_levels[score.model_key],
          testCase.name,
        );
      }
    }
  });

  it('v1 sigue compatible junto a v2 (predict/compare con el mismo snapshot)', async () => {
    const ml = client();
    const v1 = await ml.compare(example, { requestId: 'it-v1-compare' });
    const v2 = await ml.compareResearch(example, { requestId: 'it-v2-compare-2' });
    assert.equal(v1.results[1].probability_no_show, v2.results[1].probability_no_show);
    assert.ok(
      Math.abs(v1.results[0].probability_no_show - v2.results[0].probability_no_show) <= 1e-12,
    );
    assert.equal(v1.api_version, 'v1');
  });

  it('credencial incorrecta ⇒ ML_CREDENTIAL_REJECTED; versión de features ajena ⇒ 409', async () => {
    await assert.rejects(
      () =>
        client('wrong-key-wrong-key-wrong-key-wrong-key-00').getResearchPolicy({
          requestId: 'it-v2-401',
        }),
      (error: unknown) =>
        error instanceof MlUnavailableException && error.code === 'ML_CREDENTIAL_REJECTED',
    );
    await assert.rejects(
      () =>
        client().compareResearch(
          { ...example, feature_version: 'OTHER_V9' },
          { requestId: 'it-v2-409' },
        ),
      MlFeatureVersionMismatchException,
    );
  });
});
