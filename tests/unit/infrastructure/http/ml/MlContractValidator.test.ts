import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  validateBatchResponse,
  validateCompareResponse,
  validateExplanationResponse,
  validateModelsResponse,
  validatePredictionResponse,
  validateReadyResponse,
} from '../../../../../src/infrastructure/http/ml/MlContractValidator.js';
import { MlContractViolationException } from '../../../../../src/infrastructure/http/ml/errors/MlContractViolationException.js';
import { loadMlGolden } from '../../../../helpers/LoadFixture.js';

type Json = Record<string, any>;
const golden = (name: string) => loadMlGolden<Json>(name);

function violates(fn: () => unknown, path?: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof MlContractViolationException);
    if (path)
      assert.ok(
        error.issuePaths.some((p) => p.includes(path)),
        error.issuePaths.join(','),
      );
    return true;
  });
}

describe('MlContractValidator (validación runtime del OpenAPI ml-internal-v1)', () => {
  it('acepta las respuestas golden sintéticas de predict/compare/explain/batch/models/ready', () => {
    assert.equal(
      validatePredictionResponse(golden('golden_predict_rf'), 'random_forest_full_v1')
        .probability_no_show,
      0.6976400433344135,
    );
    assert.equal(
      validatePredictionResponse(golden('golden_predict_xgb'), 'xgboost_full_v1').algorithm,
      'xgboost',
    );
    assert.equal(validateCompareResponse(golden('golden_compare')).results.length, 2);
    assert.equal(
      validateExplanationResponse(golden('golden_explain_rf'), {
        modelKey: 'random_forest_full_v1',
        topK: 5,
      }).explanation.output_space,
      'probability',
    );
    assert.equal(
      validateExplanationResponse(golden('golden_explain_xgb'), {
        modelKey: 'xgboost_full_v1',
        topK: 5,
      }).explanation.output_space,
      'log_odds',
    );
    assert.equal(
      validateBatchResponse(golden('golden_batch_compare'), { mode: 'compare', itemCount: 2 })
        .count,
      2,
    );
    assert.equal(
      validateBatchResponse(golden('golden_batch_single'), {
        mode: 'single',
        itemCount: 2,
        modelKey: 'random_forest_full_v1',
      }).count,
      2,
    );
    assert.equal(validateModelsResponse(golden('golden_models')).models.length, 2);
    assert.equal(validateReadyResponse(golden('golden_ready')).status, 'ready');
  });

  it('probabilidad fuera de [0,1], string numérico o ausente ⇒ fallo (nunca score 0)', () => {
    for (const value of [1.2, -0.1, '0.5', null]) {
      violates(
        () =>
          validatePredictionResponse(
            { ...golden('golden_predict_rf'), probability_no_show: value },
            'random_forest_full_v1',
          ),
        'probability_no_show',
      );
    }
    const { probability_no_show: _p, ...missing } = golden('golden_predict_rf');
    violates(
      () => validatePredictionResponse(missing, 'random_forest_full_v1'),
      'probability_no_show',
    );
  });

  it('estados críticos ausentes o contradictorios (operational_use_allowed, risk_level) ⇒ fallo', () => {
    const { operational_use_allowed: _o, ...withoutFlag } = golden('golden_predict_rf');
    violates(
      () => validatePredictionResponse(withoutFlag, 'random_forest_full_v1'),
      'operational_use_allowed',
    );
    violates(() =>
      validatePredictionResponse(
        { ...golden('golden_predict_rf'), operational_use_allowed: true },
        'random_forest_full_v1',
      ),
    );
    violates(
      () =>
        validatePredictionResponse(
          { ...golden('golden_predict_rf'), risk_level: 'HIGH' },
          'random_forest_full_v1',
        ),
      'risk_level',
    );
    violates(() =>
      validatePredictionResponse(
        { ...golden('golden_predict_rf'), feature_version: 'V2' },
        'random_forest_full_v1',
      ),
    );
    violates(
      () =>
        validatePredictionResponse(
          { ...golden('golden_predict_rf'), model_hash: undefined },
          'random_forest_full_v1',
        ),
      'model_hash',
    );
    violates(() =>
      validatePredictionResponse(
        { ...golden('golden_predict_rf'), extra: 1 },
        'random_forest_full_v1',
      ),
    );
  });

  it('modelo distinto del solicitado o algoritmo intercambiado ⇒ fallo (sin sustitución silenciosa)', () => {
    violates(
      () => validatePredictionResponse(golden('golden_predict_rf'), 'xgboost_full_v1'),
      'model_key',
    );
    violates(
      () =>
        validatePredictionResponse(
          { ...golden('golden_predict_rf'), algorithm: 'xgboost' },
          'random_forest_full_v1',
        ),
      'algorithm',
    );
  });

  it('compare exige exactamente RF→XGB y diferencia descriptiva coherente', () => {
    const compare = golden('golden_compare');
    violates(
      () =>
        validateCompareResponse({ ...compare, results: [compare.results[1], compare.results[0]] }),
      'results',
    );
    violates(
      () => validateCompareResponse({ ...compare, results: [compare.results[0]] }),
      'results',
    );
    violates(
      () =>
        validateCompareResponse({
          ...compare,
          comparison: { ...compare.comparison, absolute_probability_difference: 0.5 },
        }),
      'comparison',
    );
    violates(
      () =>
        validateCompareResponse({
          ...compare,
          comparison: { ...compare.comparison, ensemble_probability: 0.8 },
        }),
      'ensemble_probability',
    );
  });

  it('SHAP: escala RF probability vs XGB log_odds, orden por magnitud, dirección y aditividad', () => {
    const rf = golden('golden_explain_rf');
    const xgb = golden('golden_explain_xgb');
    violates(
      () =>
        validateExplanationResponse(
          {
            ...rf,
            explanation: { ...rf.explanation, output_space: 'log_odds', output_link: 'sigmoid' },
          },
          { modelKey: 'random_forest_full_v1', topK: 5 },
        ),
      'output_space',
    );
    violates(
      () => validateExplanationResponse(xgb, { modelKey: 'xgboost_full_v1', topK: 3 }),
      'top_k',
    );
    const reversed = {
      ...rf,
      explanation: { ...rf.explanation, factors: [...rf.explanation.factors].reverse() },
    };
    violates(
      () => validateExplanationResponse(reversed, { modelKey: 'random_forest_full_v1', topK: 5 }),
      'factors',
    );
    const wrongDirection = structuredClone(rf);
    wrongDirection.explanation.factors[0].direction = 'decreases_model_output';
    violates(
      () =>
        validateExplanationResponse(wrongDirection, { modelKey: 'random_forest_full_v1', topK: 5 }),
      'direction',
    );
    const badAdditivity = structuredClone(rf);
    badAdditivity.explanation.additivity_error = 1e-3;
    violates(
      () =>
        validateExplanationResponse(badAdditivity, { modelKey: 'random_forest_full_v1', topK: 5 }),
      'additivity_error',
    );
    const badReconstruction = structuredClone(xgb);
    badReconstruction.explanation.base_value += 0.1;
    violates(
      () =>
        validateExplanationResponse(badReconstruction, { modelKey: 'xgboost_full_v1', topK: 5 }),
      'reconstructed',
    );
    const unknownFeature = structuredClone(rf);
    unknownFeature.explanation.factors[0].feature_name = 'target';
    violates(
      () =>
        validateExplanationResponse(unknownFeature, { modelKey: 'random_forest_full_v1', topK: 5 }),
      'feature_name',
    );
  });

  it('XGB: sigmoid(margen) coincide con probability_no_show dentro de 1e-6', () => {
    const xgb = golden('golden_explain_xgb');
    const sigmoid = 1 / (1 + Math.exp(-xgb.explanation.model_output_in_explanation_space));
    assert.ok(Math.abs(sigmoid - xgb.probability_no_show) < 1e-6);
    const shifted = structuredClone(xgb);
    shifted.probability_no_show = 0.5;
    violates(
      () => validateExplanationResponse(shifted, { modelKey: 'xgboost_full_v1', topK: 5 }),
      'model_output',
    );
  });

  it('batch: índices duplicados, faltantes, desordenados o count incoherente rechazan TODO', () => {
    const batch = golden('golden_batch_compare');
    violates(() => validateBatchResponse(batch, { mode: 'compare', itemCount: 3 }), 'count');
    const duplicated = structuredClone(batch);
    duplicated.results[1].index = 0;
    violates(() => validateBatchResponse(duplicated, { mode: 'compare', itemCount: 2 }), 'index');
    const swapped = structuredClone(batch);
    swapped.results = [swapped.results[1], swapped.results[0]];
    violates(() => validateBatchResponse(swapped, { mode: 'compare', itemCount: 2 }), 'index');
    const extra = structuredClone(batch);
    extra.results.push({ ...structuredClone(batch.results[0]), index: 2 });
    violates(() => validateBatchResponse(extra, { mode: 'compare', itemCount: 2 }), 'count');
    violates(() => validateBatchResponse(batch, { mode: 'single', itemCount: 2 }), 'mode');
  });

  it('catálogo: columnas predictoras deben ser exactamente las 19 en orden', () => {
    const models = golden('golden_models');
    models.models[0].predictor_columns = [...models.models[0].predictor_columns].reverse();
    violates(() => validateModelsResponse(models), 'predictor_columns');
  });
});
