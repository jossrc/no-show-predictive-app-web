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

  it('SYNTHETIC_DEMO_ONLY solo contra una base de prueba y nunca en production', () => {
    assert.throws(
      () => createPredictiveConfig(env({ DATA_SOURCE_MODE: 'SYNTHETIC_DEMO_ONLY' })),
      /base de prueba/,
    );
    const ok = createPredictiveConfig(
      env({ DATA_SOURCE_MODE: 'SYNTHETIC_DEMO_ONLY', DB_NAME_POSTGRES: 'depi_noshow_test' }),
    );
    assert.equal(ok.dataSourceMode, 'SYNTHETIC_DEMO_ONLY');
  });

  it('no existe configuración para umbrales de riesgo (no se aceptan RISK_THRESHOLDS arbitrarios)', () => {
    const parsed = env({ RISK_THRESHOLDS: '0.3,0.6' } as Record<string, string>);
    assert.ok(!('RISK_THRESHOLDS' in parsed));
  });
});
