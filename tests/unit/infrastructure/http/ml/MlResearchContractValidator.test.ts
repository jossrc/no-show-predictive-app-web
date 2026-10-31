import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  MlResearchCompareResponse,
  MlResearchPolicyCatalog,
  MlResearchPredictionResponse,
} from '../../../../../src/infrastructure/http/ml/MlContractTypes.js';
import {
  assertScoreMatchesPolicy,
  bandImpliedByContract,
  validateResearchCompareResponse,
  validateResearchPolicyCatalog,
  validateResearchPredictionResponse,
} from '../../../../../src/infrastructure/http/ml/MlResearchContractValidator.js';
import { MlContractViolationException } from '../../../../../src/infrastructure/http/ml/errors/MlContractViolationException.js';
import { loadJsonFixture, loadMlGolden } from '../../../../helpers/LoadFixture.js';

const compare = () => loadMlGolden<MlResearchCompareResponse>('golden_v2_compare');
const rf = () => loadMlGolden<MlResearchPredictionResponse>('golden_v2_predict_rf');
const policy = () => loadMlGolden<MlResearchPolicyCatalog>('golden_v2_risk_policy');

function violates(fn: () => unknown, path?: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof MlContractViolationException);
    if (path)
      assert.ok(
        error.issuePaths.some((p) => p.includes(path)),
        error.issuePaths.join(),
      );
    return true;
  });
}

describe('Contrato research v2: respuestas reales sintéticas', () => {
  it('compare real (examples/prediction_compare.json): paridad exacta con Python y bandas HIGH', () => {
    const response = validateResearchCompareResponse(compare());
    const [r, x] = response.results;
    // RF de Python varía 1–2 ULP entre llamadas (n_jobs); XGB es estable bit a bit.
    assert.ok(Math.abs(r.probability_no_show - 0.6976400433344135) <= 1e-12);
    assert.ok(Math.abs(r.probability_no_show_percent - 69.76400433344135) <= 1e-10);
    assert.equal(x.probability_no_show, 0.9159286618232727);
    assert.equal(x.probability_no_show_percent, 91.59286618232727);
    assert.ok(
      Math.abs(response.comparison.absolute_probability_difference - 0.21828861848885917) <= 1e-12,
    );
    assert.deepEqual([r.experimental_risk.level, x.experimental_risk.level], ['HIGH', 'HIGH']);
    assert.equal(response.comparison.selected_winner, null);
    assert.equal(response.comparison.ensemble_probability, null);
    for (const score of response.results) {
      assert.equal(score.risk_level, null);
      assert.equal(score.operational_use_allowed, false);
      assert.equal(score.experimental_risk.approved_by, null);
      assert.equal(score.experimental_risk.operational_use_allowed, false);
      assert.equal(score.experimental_risk.status, 'RESEARCH_PROVISIONAL');
    }
    assert.equal(
      r.experimental_risk.policy_hash,
      '1d58ce962e899b758275f7191244225e8c970cf2db9661ffcb21be9b63a4ce74',
    );
    assert.equal(
      x.experimental_risk.policy_hash,
      '208c706d839b7c8b71134cd225da4bc1bb935c5d4bd06cbb898a8d8f84ee7032',
    );
  });

  it('los 4 casos sintéticos de Python cubren LOW/MEDIUM/HIGH en ambos modelos y validan', () => {
    const { cases } = loadJsonFixture<{
      cases: Array<{ expected_levels: Record<string, string>; body: unknown }>;
    }>('fixtures/ml/golden_v2_band_cases.json');
    const seen = { random_forest_full_v1: new Set<string>(), xgboost_full_v1: new Set<string>() };
    for (const testCase of cases) {
      const response = validateResearchCompareResponse(testCase.body);
      for (const score of response.results) {
        assert.equal(score.experimental_risk.level, testCase.expected_levels[score.model_key]);
        seen[score.model_key].add(score.experimental_risk.level);
      }
    }
    assert.deepEqual([...seen.random_forest_full_v1].sort(), ['HIGH', 'LOW', 'MEDIUM']);
    assert.deepEqual([...seen.xgboost_full_v1].sort(), ['HIGH', 'LOW', 'MEDIUM']);
  });

  it('single RF/XGB v2 validan y no aceptan sustitución de modelo', () => {
    assert.equal(
      validateResearchPredictionResponse(rf(), 'random_forest_full_v1').model_key,
      'random_forest_full_v1',
    );
    const xgb = loadMlGolden('golden_v2_predict_xgb');
    assert.equal(validateResearchPredictionResponse(xgb, 'xgboost_full_v1').algorithm, 'xgboost');
    violates(() => validateResearchPredictionResponse(rf(), 'xgboost_full_v1'), 'model_key');
  });

  it('catálogo disponible y no disponible (respuestas reales) validan', () => {
    const available = validateResearchPolicyCatalog(policy());
    assert.equal(available.available, true);
    assert.equal(available.policies.length, 2);
    const unavailable = validateResearchPolicyCatalog(
      loadMlGolden('golden_v2_risk_policy_unavailable'),
    );
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.reason, 'disabled');
    assert.deepEqual(unavailable.policies, []);
  });
});

describe('Contrato research v2: fail-closed ante respuestas alteradas', () => {
  it('nivel incoherente con p y los límites declarados ⇒ violación (no se corrige en Node)', () => {
    const body = rf();
    body.experimental_risk.level = 'LOW';
    body.experimental_risk.label = 'Bajo (exploratorio)';
    violates(
      () => validateResearchPredictionResponse(body, 'random_forest_full_v1'),
      'experimental_risk.level',
    );
  });

  it('etiqueta que no corresponde al nivel ⇒ violación', () => {
    const body = rf();
    body.experimental_risk.label = 'Medio (exploratorio)';
    violates(() => validateResearchPredictionResponse(body, 'random_forest_full_v1'), 'label');
  });

  it('porcentaje distinto de 100·p ⇒ violación', () => {
    const body = rf();
    body.probability_no_show_percent += 0.001;
    violates(() => validateResearchPredictionResponse(body, 'random_forest_full_v1'), 'percent');
  });

  it('hash SHA-256 que no prolonga el hash corto, o versión ajena ⇒ violación', () => {
    const body = rf();
    body.model_hash_sha256 = 'f'.repeat(64);
    violates(
      () => validateResearchPredictionResponse(body, 'random_forest_full_v1'),
      'model_hash_sha256',
    );
    const other = rf();
    other.model_version = 'random_forest_full_v1:000000000000';
    violates(
      () => validateResearchPredictionResponse(other, 'random_forest_full_v1'),
      'model_version',
    );
  });

  it('estados operativos falsificados, approved_by o campos extra ⇒ violación de esquema', () => {
    const mutations: Array<(body: Record<string, any>) => void> = [
      (b) => (b.operational_use_allowed = true),
      (b) => (b.risk_level = 'HIGH'),
      (b) => (b.experimental_risk.approved_by = 'comite'),
      (b) => (b.experimental_risk.operational_use_allowed = true),
      (b) => (b.experimental_risk.policy_version = 'research_risk_v1'),
      (b) => (b.experimental_risk.policy_hash = 'not-a-hash'),
      (b) => (b.experimental_risk.low_upper_threshold = 0),
      (b) => (b.experimental_risk.status = 'APPROVED'),
      (b) => (b.validation_status = 'VALIDATED'),
      (b) => (b.api_version = 'v1'),
      (b) => (b.winner = 'random_forest_full_v1'),
      (b) => delete b.experimental_risk,
    ];
    for (const mutate of mutations) {
      const body = rf() as unknown as Record<string, any>;
      mutate(body);
      violates(() => validateResearchPredictionResponse(body, 'random_forest_full_v1'));
    }
  });

  it('límites invertidos ⇒ violación', () => {
    const body = rf();
    body.experimental_risk.low_upper_threshold = 0.9;
    violates(
      () => validateResearchPredictionResponse(body, 'random_forest_full_v1'),
      'low_upper_threshold',
    );
  });

  it('compare: orden de modelos, política compartida, ganador/ensemble o diferencia alterada ⇒ violación', () => {
    const swapped = compare();
    swapped.results = [swapped.results[1], swapped.results[0]];
    violates(() => validateResearchCompareResponse(swapped), 'results.model_key');

    const shared = compare();
    shared.results[1].experimental_risk.policy_hash =
      shared.results[0].experimental_risk.policy_hash;
    violates(() => validateResearchCompareResponse(shared), 'policy_hash');

    const winner = compare() as unknown as { comparison: Record<string, unknown> };
    winner.comparison.selected_winner = 'random_forest_full_v1';
    violates(() => validateResearchCompareResponse(winner));

    const diff = compare();
    diff.comparison.absolute_probability_difference = 0.5;
    violates(() => validateResearchCompareResponse(diff), 'absolute_probability_difference');
  });

  it('catálogo: disponible sin dos modelos, razón con disponible, o UNAVAILABLE con políticas ⇒ violación', () => {
    const one = policy();
    one.policies = [one.policies[0]!];
    violates(() => validateResearchPolicyCatalog(one), 'policies');

    const reasonWhileAvailable = policy();
    reasonWhileAvailable.reason = 'disabled';
    violates(() => validateResearchPolicyCatalog(reasonWhileAvailable), 'status');

    const unavailable = loadMlGolden<MlResearchPolicyCatalog>('golden_v2_risk_policy_unavailable');
    unavailable.policies = policy().policies;
    violates(() => validateResearchPolicyCatalog(unavailable), 'policies');
  });

  it('cruce score↔catálogo: hash/umbral/identidad distintos al publicado ⇒ violación', () => {
    const [rfPolicy] = policy().policies;
    assert.ok(rfPolicy);
    assert.doesNotThrow(() => assertScoreMatchesPolicy(rf(), rfPolicy, 'research_predict'));

    const tampered = rf();
    tampered.experimental_risk.policy_hash = 'a'.repeat(64);
    violates(() => assertScoreMatchesPolicy(tampered, rfPolicy, 'research_predict'), 'policy_hash');

    const threshold = rf();
    threshold.experimental_risk.high_lower_threshold = 0.46;
    violates(
      () => assertScoreMatchesPolicy(threshold, rfPolicy, 'research_predict'),
      'high_lower_threshold',
    );

    const xgbPolicy = policy().policies[1]!;
    violates(() => assertScoreMatchesPolicy(rf(), xgbPolicy, 'research_predict'), 'model_key');
  });

  it('bandImpliedByContract aplica la regla publicada con límites recibidos (frontera inclusiva izquierda)', () => {
    const limits = { low_upper_threshold: 0.3, high_lower_threshold: 0.6 };
    assert.equal(bandImpliedByContract(0.2999999, limits), 'LOW');
    assert.equal(bandImpliedByContract(0.3, limits), 'MEDIUM');
    assert.equal(bandImpliedByContract(0.5999999, limits), 'MEDIUM');
    assert.equal(bandImpliedByContract(0.6, limits), 'HIGH');
  });
});
