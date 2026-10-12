import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import pino from 'pino';
import type { Sequelize } from 'sequelize-typescript';
import { buildApp } from '../../../src/app/BuildApp.js';
import { createMlPredictionClient } from '../../../src/app/CreatePredictiveDependencies.js';
import { EnvironmentSchema } from '../../../src/config/environment/EnvironmentSchema.js';
import { createPredictiveConfig } from '../../../src/config/PredictiveConfig.js';
import { sha256Hex } from '../../../src/shared/security/VerifyInternalApiKey.js';
import { IDS, seedReservationScenario } from '../../fixtures/database/ReservationScenario.js';
import { captureSyntheticSnapshots } from '../../fixtures/database/SyntheticDemoSeed.js';
import { SqlitePredictiveStore } from '../../../src/modules/ReservationRisk/Shared/persistence/sqlite/SqlitePredictiveStore.js';
import { pgTestDbDependencies } from '../../helpers/PgTestDbDependencies.js';
import { AUTH_HEADERS, healthyCheck, TEST_INTERNAL_API_KEY } from '../../helpers/BuildTestApp.js';
import {
  connectPg,
  createTestSequelize,
  probeTestDatabase,
  resetTestDatabase,
} from '../../helpers/TestDatabase.js';
import { reportSkipped } from '../../helpers/ReportSkipped.js';

/** E2E opcional: Fastify + PostgreSQL de prueba + FastAPI REAL (loopback, clave efímera). */
const mlReady =
  process.env.ML_RUN_REAL_INTEGRATION === '1' &&
  process.env.ML_REAL_SERVICE_URL &&
  process.env.ML_REAL_SERVICE_KEY;
const skip =
  (await probeTestDatabase()) ??
  (mlReady ? null : 'SKIP: requiere ML_RUN_REAL_INTEGRATION=1 + ML_REAL_SERVICE_URL/KEY');

reportSkipped('Sprint01RealMlFlow', skip);
describe('E2E Sprint 01 con Python real', { skip: skip ?? false }, () => {
  let client: pg.Client;
  let sequelize: Sequelize;
  const store = SqlitePredictiveStore.open({ path: ':memory:', mode: 'SYNTHETIC_DEMO_ONLY' });

  before(async () => {
    await resetTestDatabase();
    client = await connectPg();
    await seedReservationScenario(client);
    sequelize = createTestSequelize();
    await captureSyntheticSnapshots(sequelize, [IDS.r1, IDS.r2, IDS.unsafe], store.snapshots);
  });
  after(async () => {
    await sequelize?.close();
    await client?.end();
  });

  it('POST compare persiste scores reales con identidad; SHAP sobre el mismo snapshot; listado ordenado', async () => {
    const config = createPredictiveConfig(
      EnvironmentSchema.parse({
        ...process.env,
        DATA_SOURCE_MODE: 'SYNTHETIC_DEMO_ONLY',
        INTERNAL_API_KEY_SHA256: sha256Hex(TEST_INTERNAL_API_KEY),
        ML_SERVICE_URL: process.env.ML_REAL_SERVICE_URL,
        ML_SERVICE_KEY: process.env.ML_REAL_SERVICE_KEY,
        ML_EXPLAIN_TIMEOUT_MS: '30000',
      }),
    );
    const ml = createMlPredictionClient(config.ml, {
      info: () => undefined,
      warn: () => undefined,
    });
    const app = buildApp({
      postgresHealthCheck: healthyCheck,
      mysqlHealthCheck: null,
      loggerInstance: pino({ level: 'silent' }) as unknown as FastifyBaseLogger,
      mlHealth: { client: ml, configured: true },
      predictiveApi: {
        internalApiKeySha256: sha256Hex(TEST_INTERNAL_API_KEY),
        dependencies: pgTestDbDependencies(config, sequelize, ml, store),
      },
    });

    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/v1/health/ml' })).json().status,
      'ok',
    );
    for (const id of [IDS.r1, IDS.r2, IDS.unsafe]) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/reservations/${id}/predictions`,
        headers: AUTH_HEADERS,
        payload: { mode: 'compare' },
      });
      assert.equal(response.statusCode, 201, response.body);
      const models = response.json().data.models as Array<{
        modelHash: string;
        probabilityNoShow: number;
        percentageNoShow: number;
      }>;
      assert.deepEqual(
        models.map((m) => m.modelHash),
        ['4e3c86a17005', '376d3db9d4d3'],
      );
      assert.ok(
        models.every(
          (m) =>
            m.probabilityNoShow > 0 &&
            m.probabilityNoShow < 1 &&
            m.percentageNoShow === m.probabilityNoShow * 100,
        ),
      );
    }

    const factors = await app.inject({
      method: 'GET',
      url: `/api/v1/reservations/${IDS.r1}/risk/factors?modelKey=xgboost_full_v1&topK=5`,
      headers: AUTH_HEADERS,
    });
    assert.equal(factors.statusCode, 200, factors.body);
    assert.equal(factors.json().data.persistedScore.sameModelIdentity, true);
    assert.ok(
      Math.abs(
        factors.json().data.probabilityNoShow -
          factors.json().data.persistedScore.probabilityNoShow,
      ) < 1e-9,
    );

    const list = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/reservations?from=2026-11-01&to=2026-11-30&sort=probabilityNoShow&direction=desc',
        headers: AUTH_HEADERS,
      })
    ).json();
    const probabilities = list.data.map(
      (d: { risk: { probabilities: Array<{ probabilityNoShow: number }> } }) =>
        d.risk.probabilities[0]?.probabilityNoShow ?? null,
    );
    const scored = probabilities.filter((p: number | null) => p !== null);
    assert.deepEqual(
      scored,
      [...scored].sort((a: number, b: number) => b - a),
    );
    assert.deepEqual(probabilities.slice(scored.length), [null, null]);
    await app.close();
  });
});
