import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import AjvModule from 'ajv';
import type { z } from 'zod';
import {
  BatchCompareResponseSchema,
  BatchSingleResponseSchema,
  ComparisonSchema,
  CompareResponseSchema,
  ExplanationResponseSchema,
  FactorSchema,
  LogOddsExplanationSchema,
  ModelDescriptorSchema,
  ModelsResponseSchema,
  PredictionResponseSchema,
  ProbabilityExplanationSchema,
  ReadyResponseSchema,
} from '../../../src/infrastructure/http/ml/MlContractSchemas.js';
import {
  ML_FEATURE_VERSION,
  ML_MODEL_KEYS,
  PREDICTOR_COLUMNS,
  toCanonicalFeatures,
} from '../../../src/infrastructure/http/ml/MlFeatureContract.js';
import { RiskFeaturesBuilder } from '../../../src/modules/ReservationRisk/Shared/calculation/RiskFeaturesBuilder.js';
import { fixturePath, loadMlGolden } from '../../helpers/LoadFixture.js';
import { makeHistory, makeVerifiedSnapshot } from '../../helpers/MakeSyntheticReservation.js';

/**
 * Contrato anclado: copia de depi-noshow-ml/docs/contracts/ml-internal-v1.openapi.json en el
 * commit f2f30b5f4cbc. Cualquier cambio en Python exige actualizar la copia y este SHA de forma
 * explícita (revisión humana), nunca automática.
 */
const PINNED_OPENAPI_SHA256 = '706d6aa310bcfc467c7a0f307d76b43b7f333054c45f7fab0f1555c0dd2138d8';
const OPENAPI_PATH = fixturePath('contracts/ml/ml-internal-v1.openapi.json');
const openApiText = readFileSync(OPENAPI_PATH, 'utf8');
const openApi = JSON.parse(openApiText) as {
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
  };
};
const schemas = openApi.components.schemas;

const Ajv = AjvModule.default ?? AjvModule;
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema({ ...openApi, $id: 'ml-openapi' });
const validatorFor = (name: string) =>
  ajv.compile({ $ref: `ml-openapi#/components/schemas/${name}` });

function zodKeys(schema: z.ZodObject): string[] {
  return Object.keys(schema.shape).sort();
}

describe('Contrato Node ↔ FastAPI (OpenAPI ml-internal-v1 versionado)', () => {
  it('la copia versionada coincide con el SHA-256 anclado', () => {
    assert.equal(createHash('sha256').update(openApiText).digest('hex'), PINNED_OPENAPI_SHA256);
  });

  it('expone exactamente las rutas que usa el cliente Node', () => {
    const expected: Array<[string, string]> = [
      ['/health/ready', 'get'],
      ['/internal/v1/models', 'get'],
      ['/internal/v1/predictions', 'post'],
      ['/internal/v1/predictions/compare', 'post'],
      ['/internal/v1/predictions/explain', 'post'],
      ['/internal/v1/predictions/batch', 'post'],
    ];
    for (const [route, method] of expected) {
      assert.ok(openApi.paths[route]?.[method], `${method.toUpperCase()} ${route}`);
    }
  });

  it('las 19 predictoras canónicas coinciden en nombre y orden con el contrato Python', () => {
    assert.deepEqual(schemas.PredictionFeatures?.required, [...PREDICTOR_COLUMNS]);
    assert.deepEqual(
      Object.keys(schemas.PredictionFeatures?.properties ?? {}).sort(),
      [...PREDICTOR_COLUMNS].sort(),
    );
    assert.equal(ML_FEATURE_VERSION, 'BOOKING_BASELINE_V1');
    const factorEnum = (schemas.Factor?.properties?.feature_name as { enum: string[] }).enum;
    assert.deepEqual(factorEnum, [...PREDICTOR_COLUMNS]);
    assert.deepEqual([...ML_MODEL_KEYS], ['random_forest_full_v1', 'xgboost_full_v1']);
  });

  it('los validadores runtime (Zod) cubren exactamente las propiedades de cada respuesta', () => {
    const pairs: Array<[string, z.ZodObject]> = [
      ['PredictionResponse', PredictionResponseSchema],
      ['CompareResponse', CompareResponseSchema],
      ['Comparison', ComparisonSchema],
      ['Factor', FactorSchema],
      ['ProbabilityExplanation', ProbabilityExplanationSchema],
      ['LogOddsExplanation', LogOddsExplanationSchema],
      ['ExplanationResponse', ExplanationResponseSchema],
      ['ModelResponse', ModelDescriptorSchema],
      ['ModelsResponse', ModelsResponseSchema],
      ['ReadyResponse', ReadyResponseSchema],
      ['BatchSingleResponse', BatchSingleResponseSchema],
      ['BatchCompareResponse', BatchCompareResponseSchema],
    ];
    for (const [name, zodSchema] of pairs) {
      assert.deepEqual(
        zodKeys(zodSchema),
        Object.keys(schemas[name]?.properties ?? {}).sort(),
        name,
      );
    }
  });

  it('las peticiones construidas por RiskFeaturesBuilder validan contra el OpenAPI (predict/compare/explain/batch)', () => {
    const built = new RiskFeaturesBuilder().build(makeVerifiedSnapshot(), makeHistory());
    assert.equal(built.kind, 'BUILT');
    if (built.kind !== 'BUILT') return;
    const base = {
      feature_version: built.value.featureVersion,
      feature_context: built.value.featureContext,
      features: toCanonicalFeatures(built.value.features),
    };
    const checks: Array<[string, unknown]> = [
      ['CompareRequest', base],
      ['PredictionRequest', { ...base, model_key: 'xgboost_full_v1' }],
      ['ExplanationRequest', { ...base, model_key: 'random_forest_full_v1', top_k: 10 }],
      [
        'BatchCompareRequest',
        { ...base, features: undefined, mode: 'compare', items: [{ features: base.features }] },
      ],
    ];
    for (const [name, payload] of checks) {
      const clean = JSON.parse(JSON.stringify(payload));
      const validate = validatorFor(name);
      assert.equal(validate(clean), true, `${name}: ${JSON.stringify(validate.errors)}`);
    }
    const withTarget = { ...base, features: { ...base.features, target: 1 } };
    assert.equal(validatorFor('CompareRequest')(withTarget), false, 'target extra debe rechazarse');
  });

  it('los goldens sintéticos satisfacen el OpenAPI y los validadores Node', () => {
    const goldens: Array<[string, string]> = [
      ['golden_predict_rf', 'PredictionResponse'],
      ['golden_compare', 'CompareResponse'],
      ['golden_explain_rf', 'ExplanationResponse'],
      ['golden_explain_xgb', 'ExplanationResponse'],
      ['golden_models', 'ModelsResponse'],
      ['golden_batch_compare', 'BatchCompareResponse'],
      ['golden_error_401', 'ErrorResponse'],
    ];
    for (const [file, name] of goldens) {
      const validate = validatorFor(name);
      assert.equal(
        validate(loadMlGolden(file)),
        true,
        `${file}: ${JSON.stringify(validate.errors)}`,
      );
    }
  });

  it('paridad opcional con el repositorio Python local (opt-in ML_CONTRACT_SOURCE_PATH)', (t) => {
    const source = process.env.ML_CONTRACT_SOURCE_PATH;
    if (!source || !existsSync(source)) {
      t.skip('SKIP: ML_CONTRACT_SOURCE_PATH no definido (no se compara con el repo Python vivo)');
      return;
    }
    const live = createHash('sha256').update(readFileSync(source)).digest('hex');
    assert.equal(
      live,
      PINNED_OPENAPI_SHA256,
      'El contrato Python cambió: revisar y re-anclar explícitamente',
    );
  });
});
