import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import AjvModule from 'ajv';
import type { z } from 'zod';
import { ComparisonSchema } from '../../../src/infrastructure/http/ml/MlContractSchemas.js';
import { PREDICTOR_COLUMNS } from '../../../src/infrastructure/http/ml/MlFeatureContract.js';
import {
  EXPERIMENTAL_RISK_LABELS,
  ExperimentalRiskSchema,
  RESEARCH_BOUNDARY_RULE,
  RESEARCH_POLICY_UNAVAILABLE_REASONS,
  RESEARCH_POLICY_VERSION,
  ResearchCompareResponseSchema,
  ResearchPolicyCatalogSchema,
  ResearchPolicyViewSchema,
  ResearchPredictionResponseSchema,
} from '../../../src/infrastructure/http/ml/MlResearchContractSchemas.js';
import { fixturePath, loadJsonFixture, loadMlGolden } from '../../helpers/LoadFixture.js';

/**
 * Contrato research v2 anclado: copia byte a byte de depi-noshow-ml
 * docs/contracts/ml-internal-v2.openapi.json y ml-internal-v2.types.ts en el commit
 * b0e11893ffff23ef3df03c681bca7276144d56a2 (verificado 2026-10-11). Un cambio en Python exige
 * re-anclar estos SHA-256 explícitamente (revisión humana).
 */
const PINNED_V2_OPENAPI_SHA256 = '840b48d69f901a6606d21a98d334f0ab1fb22551f623ee75423fff67edf65ce6';
const PINNED_V2_TYPES_SHA256 = 'eb40e5dcf2000d851bf17da4cd3bdea8537ab13485618707e8b582b22a625d8b';
const OPENAPI_PATH = fixturePath('contracts/ml/ml-internal-v2.openapi.json');
const TYPES_PATH = fixturePath('contracts/ml/ml-internal-v2.types.ts.txt');
const openApiText = readFileSync(OPENAPI_PATH, 'utf8');
const openApi = JSON.parse(openApiText) as {
  info: { version: string };
  paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
  components: {
    schemas: Record<
      string,
      { properties?: Record<string, { const?: unknown; enum?: unknown[] }>; required?: string[] }
    >;
  };
};
const schemas = openApi.components.schemas;

const Ajv = AjvModule.default ?? AjvModule;
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema({ ...openApi, $id: 'ml-openapi-v2' });
const validatorFor = (name: string) =>
  ajv.compile({ $ref: `ml-openapi-v2#/components/schemas/${name}` });

const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const zodKeys = (schema: z.ZodObject) => Object.keys(schema.shape).sort();

describe('Contrato Node ↔ FastAPI research v2 (OpenAPI ml-internal-v2 versionado)', () => {
  it('las copias versionadas coinciden con los SHA-256 anclados', () => {
    assert.equal(sha256(openApiText), PINNED_V2_OPENAPI_SHA256);
    assert.equal(sha256(readFileSync(TYPES_PATH)), PINNED_V2_TYPES_SHA256);
    assert.equal(openApi.info.version, 'v2');
  });

  it('expone exactamente las tres rutas v2 que usa Node (sin explain ni batch v2)', () => {
    assert.deepEqual(Object.keys(openApi.paths).sort(), [
      '/internal/v2/predictions',
      '/internal/v2/predictions/compare',
      '/internal/v2/risk-policy',
    ]);
    assert.ok(openApi.paths['/internal/v2/risk-policy']?.get);
    assert.ok(openApi.paths['/internal/v2/predictions']?.post);
    assert.ok(openApi.paths['/internal/v2/predictions/compare']?.post);
    for (const route of Object.values(openApi.paths)) {
      for (const operation of Object.values(route)) {
        for (const status of ['200', '401', '409', '413', '422', '429', '503']) {
          assert.ok(operation.responses?.[status], `respuesta ${status} documentada`);
        }
      }
    }
  });

  it('las peticiones v2 son idénticas a v1: 19 predictoras canónicas', () => {
    assert.deepEqual(schemas.PredictionFeatures?.required, [...PREDICTOR_COLUMNS]);
  });

  it('los validadores Zod cubren exactamente las propiedades de cada respuesta v2', () => {
    const pairs: Array<[string, z.ZodObject]> = [
      ['ExperimentalRisk', ExperimentalRiskSchema],
      ['ResearchPredictionResponse', ResearchPredictionResponseSchema],
      ['ResearchCompareResponse', ResearchCompareResponseSchema],
      ['ResearchPolicyView', ResearchPolicyViewSchema],
      ['ResearchPolicyCatalog', ResearchPolicyCatalogSchema],
      ['Comparison', ComparisonSchema],
    ];
    for (const [name, zodSchema] of pairs) {
      assert.deepEqual(
        zodKeys(zodSchema),
        Object.keys(schemas[name]?.properties ?? {}).sort(),
        name,
      );
    }
  });

  it('constantes Node = constantes del contrato (versión, regla, etiquetas, razones)', () => {
    const risk = schemas.ExperimentalRisk?.properties ?? {};
    assert.equal(risk.policy_version?.const, RESEARCH_POLICY_VERSION);
    assert.equal(risk.boundary_rule?.const, RESEARCH_BOUNDARY_RULE);
    assert.deepEqual(risk.label?.enum, Object.values(EXPERIMENTAL_RISK_LABELS));
    assert.deepEqual(risk.level?.enum, ['LOW', 'MEDIUM', 'HIGH']);
    const reason = schemas.ResearchPolicyCatalog?.properties?.reason as {
      anyOf: Array<{ enum?: string[] }>;
    };
    assert.deepEqual(reason.anyOf[0]?.enum, [...RESEARCH_POLICY_UNAVAILABLE_REASONS]);
  });

  it('los goldens v2 reales (entradas sintéticas) satisfacen el OpenAPI v2', () => {
    const goldens: Array<[string, string]> = [
      ['golden_v2_risk_policy', 'ResearchPolicyCatalog'],
      ['golden_v2_risk_policy_unavailable', 'ResearchPolicyCatalog'],
      ['golden_v2_predict_rf', 'ResearchPredictionResponse'],
      ['golden_v2_predict_xgb', 'ResearchPredictionResponse'],
      ['golden_v2_compare', 'ResearchCompareResponse'],
      ['golden_v2_error_503_policy', 'ErrorResponse'],
    ];
    for (const [file, name] of goldens) {
      const validate = validatorFor(name);
      assert.equal(
        validate(loadMlGolden(file)),
        true,
        `${file}: ${JSON.stringify(validate.errors)}`,
      );
    }
    const { cases } = loadJsonFixture<{ cases: Array<{ request: unknown; body: unknown }> }>(
      'fixtures/ml/golden_v2_band_cases.json',
    );
    for (const testCase of cases) {
      assert.equal(validatorFor('CompareRequest')(testCase.request), true);
      assert.equal(validatorFor('ResearchCompareResponse')(testCase.body), true);
    }
  });

  it('el catálogo real publica los hashes de política fijados por Python', () => {
    const catalog = loadMlGolden<{ policies: Array<{ model_key: string; policy_hash: string }> }>(
      'golden_v2_risk_policy',
    );
    assert.deepEqual(
      Object.fromEntries(catalog.policies.map((policy) => [policy.model_key, policy.policy_hash])),
      {
        random_forest_full_v1: '1d58ce962e899b758275f7191244225e8c970cf2db9661ffcb21be9b63a4ce74',
        xgboost_full_v1: '208c706d839b7c8b71134cd225da4bc1bb935c5d4bd06cbb898a8d8f84ee7032',
      },
    );
  });

  it('paridad opcional con el repositorio Python local (opt-in ML_CONTRACT_SOURCE_DIR)', (t) => {
    const dir = process.env.ML_CONTRACT_SOURCE_DIR;
    if (!dir || !existsSync(path.join(dir, 'ml-internal-v2.openapi.json'))) {
      t.skip('SKIP: ML_CONTRACT_SOURCE_DIR no definido (no se compara con el repo Python vivo)');
      return;
    }
    assert.equal(
      sha256(readFileSync(path.join(dir, 'ml-internal-v2.openapi.json'))),
      PINNED_V2_OPENAPI_SHA256,
    );
    assert.equal(
      sha256(readFileSync(path.join(dir, 'ml-internal-v2.types.ts'))),
      PINNED_V2_TYPES_SHA256,
    );
    assert.equal(
      sha256(readFileSync(path.join(dir, 'ml-internal-v1.openapi.json'))),
      '706d6aa310bcfc467c7a0f307d76b43b7f333054c45f7fab0f1555c0dd2138d8',
    );
  });
});
