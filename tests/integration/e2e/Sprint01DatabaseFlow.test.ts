import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import pino from 'pino';
import type { FastifyBaseLogger } from 'fastify';
import type { Sequelize } from 'sequelize-typescript';
import { buildApp } from '../../../src/app/BuildApp.js';
import { createPredictiveDependencies } from '../../../src/app/CreatePredictiveDependencies.js';
import { EnvironmentSchema } from '../../../src/config/environment/EnvironmentSchema.js';
import { createPredictiveConfig } from '../../../src/config/PredictiveConfig.js';
import type { DataSourceMode } from '../../../src/shared/data/DataSourceMode.js';
import { sha256Hex } from '../../../src/shared/security/VerifyInternalApiKey.js';
import { IDS, seedReservationScenario } from '../../fixtures/database/ReservationScenario.js';
import { captureSyntheticSnapshots } from '../../fixtures/database/SyntheticDemoSeed.js';
import { AUTH_HEADERS, healthyCheck, TEST_INTERNAL_API_KEY } from '../../helpers/BuildTestApp.js';
import { FakePredictionClient } from '../../helpers/FakePredictionClient.js';
import { FixedClock } from '../../helpers/FixedClock.js';
import {
  connectPg,
  countRows,
  createTestSequelize,
  probeTestDatabase,
  resetTestDatabase,
} from '../../helpers/TestDatabase.js';
import { reportSkipped } from '../../helpers/ReportSkipped.js';

const skip = await probeTestDatabase();
reportSkipped('Sprint01DatabaseFlow', skip);
const SOURCE_TABLES = [
  'raw_flow.diary_gen',
  'raw_flow.clients',
  'analytics.appointment_outcomes',
  'analytics.appointment_services',
  'analytics.ml_history_cumulative_v1',
  'analytics.appointment_events',
];

function buildDatabaseApp(
  sequelize: Sequelize,
  ml: FakePredictionClient,
  mode: DataSourceMode,
): FastifyInstance {
  const config = createPredictiveConfig(
    EnvironmentSchema.parse({
      ...process.env,
      DATA_SOURCE_MODE: mode,
      INTERNAL_API_KEY_SHA256: sha256Hex(TEST_INTERNAL_API_KEY),
    }),
  );
  return buildApp({
    postgresHealthCheck: healthyCheck,
    mysqlHealthCheck: null,
    loggerInstance: pino({ level: 'silent' }) as unknown as FastifyBaseLogger,
    predictiveApi: {
      internalApiKeySha256: sha256Hex(TEST_INTERNAL_API_KEY),
      // Reloj fijo posterior a los eventos sintéticos: current_known determinista.
      dependencies: {
        ...createPredictiveDependencies(config, sequelize, ml),
        clock: new FixedClock(new Date('2027-01-15T00:00:00Z')),
      },
    },
  });
}

describe(
  'E2E Sprint 01 con PostgreSQL de prueba + Python simulado',
  { skip: skip ?? false },
  () => {
    let client: pg.Client;
    let sequelize: Sequelize;
    const sourceCounts = new Map<string, number>();

    before(async () => {
      await resetTestDatabase();
      client = await connectPg();
      await seedReservationScenario(client);
      for (const table of SOURCE_TABLES) sourceCounts.set(table, await countRows(client, table));
      sequelize = createTestSequelize();
    });
    after(async () => {
      for (const table of SOURCE_TABLES) {
        assert.equal(
          await countRows(client, table),
          sourceCounts.get(table),
          `${table} no debe cambiar`,
        );
      }
      await sequelize?.close();
      await client?.end();
    });

    it('READ_ONLY_EXISTING_SCHEDULE: la réplica no demuestra snapshots ⇒ listado NOT_SCORABLE, POST 409, cero escrituras', async () => {
      const ml = new FakePredictionClient();
      const app = buildDatabaseApp(sequelize, ml, 'READ_ONLY_EXISTING_SCHEDULE');
      const list = await app.inject({
        method: 'GET',
        url: '/api/v1/reservations?from=2026-11-01&to=2026-11-30',
        headers: AUTH_HEADERS,
      });
      assert.equal(list.statusCode, 200);
      assert.deepEqual(
        list.json().data.map((d: { reservationId: string }) => d.reservationId),
        [IDS.r1, IDS.r2, IDS.rescheduled, IDS.noCreated, IDS.unsafe],
      );
      assert.ok(
        list
          .json()
          .data.every(
            (d: { risk: { predictionAvailability: string } }) =>
              d.risk.predictionAvailability === 'NOT_SCORABLE',
          ),
      );

      const post = await app.inject({
        method: 'POST',
        url: `/api/v1/reservations/${IDS.r1}/predictions`,
        headers: AUTH_HEADERS,
        payload: { mode: 'compare' },
      });
      assert.deepEqual([post.statusCode, post.json().error.code], [409, 'NOT_SCORABLE']);
      assert.equal(ml.calls.length, 0);
      assert.equal(await countRows(client, 'ml.booking_feature_snapshots'), 0);
      await app.close();
    });

    it('SYNTHETIC_DEMO_ONLY: listado → POST compare → riesgo → factores → historial, con persistencia auditable', async () => {
      await captureSyntheticSnapshots(sequelize, [IDS.r1, IDS.r2]);
      const ml = new FakePredictionClient();
      ml.setProbability('random_forest_full_v1', 0.31);
      const app = buildDatabaseApp(sequelize, ml, 'SYNTHETIC_DEMO_ONLY');
      const get = (url: string) => app.inject({ method: 'GET', url, headers: AUTH_HEADERS });

      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/reservations/${IDS.r2}/predictions`,
        headers: AUTH_HEADERS,
        payload: { mode: 'compare' },
      });
      assert.equal(created.statusCode, 201);
      const replay = await app.inject({
        method: 'POST',
        url: `/api/v1/reservations/${IDS.r2}/predictions`,
        headers: AUTH_HEADERS,
        payload: { mode: 'compare' },
      });
      assert.equal(replay.statusCode, 200);
      assert.equal(ml.callsOf('compare').length, 1);

      const runs = await client.query(
        `SELECT count(*)::int AS n, max(request_id) AS rid FROM ml.prediction_runs`,
      );
      assert.equal(runs.rows[0].n, 1);
      const persisted = await client.query(
        `SELECT model_key, probability_no_show, risk_level, operational_use_allowed, prediction_at FROM ml.prediction_model_results ORDER BY model_key`,
      );
      assert.deepEqual(
        persisted.rows.map((r) => [
          r.model_key,
          r.probability_no_show,
          r.risk_level,
          r.operational_use_allowed,
        ]),
        [
          ['random_forest_full_v1', 0.31, null, false],
          ['xgboost_full_v1', 0.9159286618232727, null, false],
        ],
      );
      assert.equal(
        persisted.rows[0].prediction_at.toISOString(),
        '2026-10-20T16:00:00.000Z',
        'prediction_at = creación de la reserva',
      );

      const sorted = (
        await get(
          '/api/v1/reservations?from=2026-11-01&to=2026-11-30&sort=probabilityNoShow&direction=desc',
        )
      ).json();
      assert.deepEqual(
        sorted.data
          .slice(0, 2)
          .map((d: { reservationId: string; risk: { predictionAvailability: string } }) => [
            d.reservationId,
            d.risk.predictionAvailability,
          ]),
        [
          [IDS.r2, 'AVAILABLE_EXPLORATORY'],
          [IDS.r1, 'NOT_SCORED'],
        ],
      );
      assert.equal(sorted.data[0].risk.probabilities[0].percentageNoShow, 31);

      const risk = (await get(`/api/v1/reservations/${IDS.r2}/risk`)).json().data;
      assert.equal(risk.status, 'AVAILABLE_EXPLORATORY');
      assert.equal(risk.snapshot.evidenceSource, 'SYNTHETIC_DEMO_ONLY');

      const factors = (
        await get(
          `/api/v1/reservations/${IDS.r2}/risk/factors?modelKey=random_forest_full_v1&topK=3`,
        )
      ).json().data;
      assert.equal(factors.explanation.factors.length, 3);
      const sentFeatures = (
        ml.callsOf('explain')[0]!.request as { features: Record<string, unknown> }
      ).features;
      const stored = await client.query(
        `SELECT features FROM ml.booking_feature_snapshots WHERE reservation_id = $1`,
        [IDS.r2],
      );
      assert.deepEqual(
        sentFeatures,
        stored.rows[0].features,
        'SHAP usa exactamente el snapshot persistido',
      );

      const historyData = (await get(`/api/v1/reservations/${IDS.r1}/client-history`)).json().data;
      assert.deepEqual(
        [historyData.previousAttended, historyData.previousNoShow, historyData.noShowRate],
        [1, 1, 0.5],
      );
      const current = (
        await get(`/api/v1/reservations/${IDS.r1}/client-history?historicalAsOf=current_known`)
      ).json().data;
      assert.deepEqual([current.previousAttended, current.previousNoShow], [2, 2]);
      await app.close();
    });
  },
);
