import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EnvironmentSchema } from '../../../src/config/environment/EnvironmentSchema.js';
import { createPredictiveConfig } from '../../../src/config/PredictiveConfig.js';

const HASH = 'a'.repeat(64);

function env(overrides: Record<string, string> = {}) {
  return EnvironmentSchema.parse({
    DB_HOST_POSTGRES: 'localhost',
    DB_USER_POSTGRES: 'u',
    DB_NAME_POSTGRES: 'depi-noshow-db',
    ...overrides,
  });
}

describe('PredictiveConfig (seguridad transversal mínima Sprint 01)', () => {
  it('sin hash de credencial interna las rutas de negocio NO se registran', () => {
    const config = createPredictiveConfig(env());
    assert.equal(config.api.enabled, false);
    assert.match(config.api.disabledReason ?? '', /INTERNAL_API_KEY_SHA256/);
  });

  it('con hash válido se habilitan en development; production falla en startup (HU-21/22 pendiente)', () => {
    assert.equal(createPredictiveConfig(env({ INTERNAL_API_KEY_SHA256: HASH })).api.enabled, true);
    assert.throws(
      () =>
        createPredictiveConfig(
          env({
            NODE_ENV: 'production',
            INTERNAL_API_KEY_SHA256: HASH,
            ML_SERVICE_URL: 'https://127.0.0.1',
          }),
        ),
      /AUTH_FULL_FLOW_PENDING_HU21_HU22/,
    );
    const disabled = createPredictiveConfig(
      env({
        NODE_ENV: 'production',
        PREDICTIVE_API_ENABLED: 'false',
        ML_SERVICE_URL: 'https://127.0.0.1',
      }),
    );
    assert.equal(disabled.api.enabled, false);
  });

  it('rechaza hashes mal formados y claves ML débiles', () => {
    assert.throws(() => env({ INTERNAL_API_KEY_SHA256: 'not-a-hash' }));
    assert.throws(() => env({ ML_SERVICE_KEY: 'short' }));
    assert.throws(() => env({ ML_SERVICE_KEY: `${'a'.repeat(32)} b` }));
  });

  it('SYNTHETIC_DEMO_ONLY usa solo el dataset local y su propio SQLite; nunca en production', () => {
    // Desde ADR-006 el modo sintético no lee ni escribe datos de negocio en PostgreSQL, por lo
    // que ya no exige una base de prueba; la separación la garantizan proveedor y archivo propios.
    const synthetic = createPredictiveConfig(env({ DATA_SOURCE_MODE: 'SYNTHETIC_DEMO_ONLY' }));
    assert.equal(synthetic.dataSourceMode, 'SYNTHETIC_DEMO_ONLY');
    assert.equal(synthetic.store.sqlitePath, '.local/predictive-store/synthetic_demo_only.sqlite');
    const real = createPredictiveConfig(env());
    assert.equal(
      real.store.sqlitePath,
      '.local/predictive-store/read_only_existing_schedule.sqlite',
    );
    assert.notEqual(synthetic.store.sqlitePath, real.store.sqlitePath);

    assert.throws(
      () =>
        createPredictiveConfig(
          env({
            NODE_ENV: 'production',
            PREDICTIVE_API_ENABLED: 'false',
            DATA_SOURCE_MODE: 'SYNTHETIC_DEMO_ONLY',
          }),
        ),
      /no está permitido en production/,
    );
  });

  it('política research v2: habilitada por defecto, flag estricto y allowlist de hashes validada', () => {
    const defaults = createPredictiveConfig(env());
    assert.equal(defaults.ml.researchRiskEnabled, true);
    assert.deepEqual(defaults.ml.expectedResearchPolicyHashes, []);
    assert.equal(
      createPredictiveConfig(env({ ML_RESEARCH_RISK_ENABLED: 'false' })).ml.researchRiskEnabled,
      false,
    );
    assert.throws(() => env({ ML_RESEARCH_RISK_ENABLED: 'yes' }));
    const pinned = createPredictiveConfig(
      env({ ML_RESEARCH_EXPECTED_POLICY_HASHES: `${'1'.repeat(64)},${'2'.repeat(64)}` }),
    );
    assert.deepEqual(pinned.ml.expectedResearchPolicyHashes, ['1'.repeat(64), '2'.repeat(64)]);
    assert.throws(() => env({ ML_RESEARCH_EXPECTED_POLICY_HASHES: 'not-a-hash' }));
    assert.equal(
      createPredictiveConfig(env({ PREDICTIVE_STORE_SQLITE_PATH: '/tmp/x.sqlite' })).store
        .sqlitePath,
      '/tmp/x.sqlite',
    );
  });

  it('no existe configuración para umbrales de riesgo (no se aceptan RISK_THRESHOLDS arbitrarios)', () => {
    const parsed = env({ RISK_THRESHOLDS: '0.3,0.6' } as Record<string, string>);
    assert.ok(!('RISK_THRESHOLDS' in parsed));
  });
});
