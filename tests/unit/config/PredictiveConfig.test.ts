import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EnvironmentSchema } from '../../../src/config/environment/EnvironmentSchema.js';
import { createPredictiveConfig } from '../../../src/config/PredictiveConfig.js';

const HASH = 'a'.repeat(64);
const APP_DB = {
  APP_DB_HOST_POSTGRES: 'localhost',
  APP_DB_NAME_POSTGRES: 'depi-noshow-db',
  APP_DB_USER_POSTGRES: 'noshow_app_runtime',
  APP_DB_PASS_POSTGRES: 'x',
};

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
    assert.equal(
      createPredictiveConfig(env({ INTERNAL_API_KEY_SHA256: HASH, ...APP_DB })).api.enabled,
      true,
    );
    assert.throws(
      () =>
        createPredictiveConfig(
          env({
            NODE_ENV: 'production',
            INTERNAL_API_KEY_SHA256: HASH,
            ML_SERVICE_URL: 'https://127.0.0.1',
            ...APP_DB,
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

  it('SYNTHETIC_DEMO_ONLY usa solo el dataset local y su almacén PostgreSQL ligado; nunca en production', () => {
    // El modo sintético no lee datos de negocio de la fuente; su separación del real la garantiza
    // la identidad de modo ligada a la base del almacén (ml.app_predictive_store_identity).
    const synthetic = createPredictiveConfig(
      env({ DATA_SOURCE_MODE: 'SYNTHETIC_DEMO_ONLY', INTERNAL_API_KEY_SHA256: HASH, ...APP_DB }),
    );
    assert.equal(synthetic.dataSourceMode, 'SYNTHETIC_DEMO_ONLY');
    assert.equal(synthetic.store.driver, 'postgresql');

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
  });

  it('almacén PostgreSQL de la app (ADR-008): credenciales obligatorias, rol separado, sin SQLite', () => {
    // Rutas deshabilitadas: no se exige conexión de la app.
    assert.equal(createPredictiveConfig(env()).store.database, null);
    // Rutas habilitadas sin APP_DB_*: falla al arrancar (nunca fallback a SQLite ni memoria).
    assert.throws(
      () => createPredictiveConfig(env({ INTERNAL_API_KEY_SHA256: HASH })),
      /APP_DB_HOST_POSTGRES, APP_DB_NAME_POSTGRES, APP_DB_USER_POSTGRES/,
    );
    const config = createPredictiveConfig(
      env({ INTERNAL_API_KEY_SHA256: HASH, ...APP_DB, APP_DB_STATEMENT_TIMEOUT_MS: '3000' }),
    );
    assert.equal(config.store.driver, 'postgresql');
    assert.deepEqual(
      {
        user: config.store.database?.user,
        database: config.store.database?.database,
        statementTimeoutMs: config.store.database?.statementTimeoutMs,
      },
      { user: 'noshow_app_runtime', database: 'depi-noshow-db', statementTimeoutMs: 3000 },
    );
    assert.equal(config.store.allowPrivilegedRole, false);
    assert.ok(!('sqlitePath' in config.store));
    // El rol de la app no puede ser el de la fuente de solo lectura (salvo excepción local).
    assert.throws(
      () =>
        createPredictiveConfig(
          env({ INTERNAL_API_KEY_SHA256: HASH, ...APP_DB, APP_DB_USER_POSTGRES: 'u' }),
        ),
      /rol distinto/,
    );
    assert.equal(
      createPredictiveConfig(
        env({
          INTERNAL_API_KEY_SHA256: HASH,
          ...APP_DB,
          APP_DB_USER_POSTGRES: 'u',
          APP_DB_ALLOW_PRIVILEGED_ROLE: 'true',
        }),
      ).store.allowPrivilegedRole,
      true,
    );
    // La excepción de rol privilegiado jamás se admite en production.
    assert.throws(
      () =>
        createPredictiveConfig(
          env({
            NODE_ENV: 'production',
            PREDICTIVE_API_ENABLED: 'false',
            APP_DB_ALLOW_PRIVILEGED_ROLE: 'true',
            ML_SERVICE_URL: 'https://127.0.0.1',
          }),
        ),
      /APP_DB_ALLOW_PRIVILEGED_ROLE/,
    );
  });

  it('no existe configuración para umbrales de riesgo (no se aceptan RISK_THRESHOLDS arbitrarios)', () => {
    const parsed = env({ RISK_THRESHOLDS: '0.3,0.6' } as Record<string, string>);
    assert.ok(!('RISK_THRESHOLDS' in parsed));
  });
});
