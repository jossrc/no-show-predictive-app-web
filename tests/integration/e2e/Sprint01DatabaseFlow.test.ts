import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import pino from 'pino';
import type { FastifyBaseLogger } from 'fastify';
import type { Sequelize } from 'sequelize-typescript';
import { buildApp } from '../../../src/app/BuildApp.js';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqlitePredictiveStore } from '../../../src/modules/ReservationRisk/Shared/persistence/sqlite/SqlitePredictiveStore.js';
import { pgTestDbDependencies } from '../../helpers/PgTestDbDependencies.js';
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
  store: SqlitePredictiveStore,
): FastifyInstance {
  const config = createPredictiveConfig(
    EnvironmentSchema.parse({
      ...process.env,
      DATA_SOURCE_MODE: mode,
      INTERNAL_API_KEY_SHA256: sha256Hex(TEST_INTERNAL_API_KEY),
      ML_RESEARCH_RISK_ENABLED: String(mode === 'READ_ONLY_EXISTING_SCHEDULE'),
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
        ...pgTestDbDependencies(config, sequelize, ml, store),
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

    it('READ_ONLY_EXISTING_SCHEDULE: sin copias ⇒ 19 predictoras, compare research, SQLite, GET y replay', async () => {
      const ml = new FakePredictionClient();
      const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'nsp-flowww-')), 'store.sqlite');
      const store = SqlitePredictiveStore.open({
        path: file,
        mode: 'READ_ONLY_EXISTING_SCHEDULE',
      });
      const local = new DatabaseSync(file, { readOnly: true });
      const app = buildDatabaseApp(sequelize, ml, 'READ_ONLY_EXISTING_SCHEDULE', store);
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
      assert.deepEqual(
        list
          .json()
          .data.map(
            (d: { risk: { predictionAvailability: string } }) => d.risk.predictionAvailability,
          ),
        ['NOT_SCORED', 'NOT_SCORED', 'NOT_SCORABLE', 'NOT_SCORABLE', 'NOT_SCORED'],
      );

      const beforeRisk = await app.inject({
        method: 'GET',
        url: `/api/v1/reservations/${IDS.r1}/risk`,
        headers: AUTH_HEADERS,
      });
      assert.equal(beforeRisk.statusCode, 200);
      assert.equal(beforeRisk.json().data.status, 'NOT_SCORED');

      const post = await app.inject({
        method: 'POST',
        url: `/api/v1/reservations/${IDS.r1}/predictions`,
        headers: AUTH_HEADERS,
        payload: { mode: 'compare' },
      });
      assert.equal(post.statusCode, 201, post.body);
      assert.equal(post.json().data.status, 'AVAILABLE_EXPLORATORY');
      assert.equal(ml.callsOf('research_compare').length, 1);
      const snapshot = local
        .prepare(
          'SELECT features_json, evidence_json, snapshot_hash FROM booking_feature_snapshots',
        )
        .get()!;
      assert.equal(Object.keys(JSON.parse(String(snapshot.features_json))).length, 19);
      assert.equal(
        JSON.parse(String(snapshot.evidence_json)).servicesTemporalEvidence,
        'FLOWWW_UNCHANGED_BOOKING',
      );
      assert.match(String(snapshot.snapshot_hash), /^[a-f0-9]{64}$/);
      assert.equal(local.prepare('SELECT count(*) AS n FROM prediction_model_results').get()?.n, 2);
      const risk = await app.inject({
        method: 'GET',
        url: `/api/v1/reservations/${IDS.r1}/risk`,
        headers: AUTH_HEADERS,
      });
      assert.equal(risk.statusCode, 200);
      assert.equal(risk.json().data.status, 'AVAILABLE_EXPLORATORY');
      assert.deepEqual(
        risk.json().data.models.map((m: { modelKey: string }) => m.modelKey),
        ['random_forest_full_v1', 'xgboost_full_v1'],
      );
      assert.ok(
        risk
          .json()
          .data.models.every(
            (m: { operationalUseAllowed: boolean; experimentalRisk: unknown }) =>
              m.operationalUseAllowed === false && m.experimentalRisk !== null,
          ),
      );
      const replay = await app.inject({
        method: 'POST',
        url: `/api/v1/reservations/${IDS.r1}/predictions`,
        headers: AUTH_HEADERS,
        payload: { mode: 'compare' },
      });
      assert.equal(replay.statusCode, 200);
      assert.equal(replay.json().data.run.replayed, true);
      assert.equal(ml.callsOf('research_compare').length, 1);
      assert.equal(local.prepare('SELECT count(*) AS n FROM prediction_runs').get()?.n, 1);
      assert.equal(
        local.prepare('SELECT count(*) AS n FROM booking_feature_snapshots').get()?.n,
        1,
      );
      assert.deepEqual(
        local
          .prepare(
            'SELECT features_json, evidence_json, snapshot_hash FROM booking_feature_snapshots',
          )
          .get(),
        snapshot,
      );
      for (const id of [IDS.r2, IDS.rescheduled, IDS.noCreated, IDS.cancelled]) {
        const rejected = await app.inject({
          method: 'POST',
          url: `/api/v1/reservations/${id}/predictions`,
          headers: AUTH_HEADERS,
          payload: { mode: 'compare' },
        });
        assert.equal(rejected.statusCode, 409, rejected.body);
        assert.equal(rejected.json().error.code, 'NOT_SCORABLE');
      }
      assert.equal(ml.callsOf('research_compare').length, 1);
      assert.equal(await countRows(client, 'ml.booking_feature_snapshots'), 0);
      await app.close();
      local.close();
      store.close();
    });

    it('SYNTHETIC_DEMO_ONLY: listado → POST compare → riesgo → factores → historial, con persistencia auditable', async () => {
      const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'nsp-flow-')), 'store.sqlite');
      const store = SqlitePredictiveStore.open({ path: file, mode: 'SYNTHETIC_DEMO_ONLY' });
      await captureSyntheticSnapshots(sequelize, [IDS.r1, IDS.r2], store.snapshots);
      const local = new DatabaseSync(file, { readOnly: true });
      const ml = new FakePredictionClient();
      ml.setProbability('random_forest_full_v1', 0.31);
      const app = buildDatabaseApp(sequelize, ml, 'SYNTHETIC_DEMO_ONLY', store);
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

      // Persistencia auditable en el almacén LOCAL; el schema ml de PostgreSQL no se toca.
      assert.equal(local.prepare('SELECT count(*) AS n FROM prediction_runs').get()?.n, 1);
      const persisted = local
        .prepare(
          'SELECT model_key, probability_no_show, risk_level, operational_use_allowed, prediction_at FROM prediction_model_results ORDER BY model_key',
        )
        .all();
      assert.deepEqual(
        persisted.map((r) => [
          r.model_key,
          r.probability_no_show,
          r.risk_level,
          r.operational_use_allowed,
        ]),
        [
          ['random_forest_full_v1', 0.31, null, 0],
          ['xgboost_full_v1', 0.9159286618232727, null, 0],
        ],
      );
      assert.equal(
        persisted[0]?.prediction_at,
        '2026-10-20T16:00:00.000Z',
        'prediction_at = creación de la reserva',
      );
      assert.equal(await countRows(client, 'ml.prediction_runs'), 0);

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
      const stored = local
        .prepare('SELECT features_json FROM booking_feature_snapshots WHERE reservation_id = ?')
        .get(IDS.r2);
      assert.deepEqual(
        sentFeatures,
        JSON.parse(String(stored?.features_json)),
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
      local.close();
      await app.close();
    });
  },
);
