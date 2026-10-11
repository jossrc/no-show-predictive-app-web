import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type pg from 'pg';
import pino from 'pino';
import type { Sequelize } from 'sequelize-typescript';
import { buildApp } from '../../src/app/BuildApp.js';
import {
  createMlPredictionClient,
  createPredictiveDependencies,
} from '../../src/app/CreatePredictiveDependencies.js';
import { EnvironmentSchema } from '../../src/config/environment/EnvironmentSchema.js';
import { createPredictiveConfig } from '../../src/config/PredictiveConfig.js';
import type { MlCompareRequest } from '../../src/infrastructure/http/ml/MlContractTypes.js';
import type { MlPredictionClient } from '../../src/infrastructure/http/ml/MlPredictionClient.js';
import { SequelizeClientHistoryRepository } from '../../src/modules/ClientHistory/Shared/persistence/sequelize/SequelizeClientHistoryRepository.js';
import { sha256Hex } from '../../src/shared/security/VerifyInternalApiKey.js';
import { AUTH_HEADERS, healthyCheck, TEST_INTERNAL_API_KEY } from '../helpers/BuildTestApp.js';
import { FakePredictionClient } from '../helpers/FakePredictionClient.js';
import { FixedClock } from '../helpers/FixedClock.js';
import { fixturePath, loadJsonFixture } from '../helpers/LoadFixture.js';
import {
  connectPg,
  createTestSequelize,
  probeTestDatabase,
  resetTestDatabase,
} from '../helpers/TestDatabase.js';
import { reportSkipped } from '../helpers/ReportSkipped.js';

/**
 * Benchmark de LABORATORIO (no SLA): RUN_PERFORMANCE=1, BD de prueba aislada, datos sintéticos.
 * Las cifras dependen del hardware y se escriben en reports/performance/.
 */
const enabled = process.env.RUN_PERFORMANCE === '1';
const skip = enabled ? await probeTestDatabase() : 'SKIP: RUN_PERFORMANCE=1 no definido';
const realMl =
  process.env.ML_RUN_REAL_INTEGRATION === '1' &&
  process.env.ML_REAL_SERVICE_URL &&
  process.env.ML_REAL_SERVICE_KEY;

reportSkipped('Sprint01Performance', skip);
interface Stats {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    n: sorted.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    p99: round(at(0.99)),
    max: round(sorted.at(-1)!),
  };
}

async function measure(
  iterations: number,
  warmup: number,
  run: () => Promise<unknown>,
): Promise<Stats> {
  for (let i = 0; i < warmup; i += 1) await run();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    await run();
    samples.push(performance.now() - start);
  }
  return stats(samples);
}

/** Inserta N reservas FUTURE sintéticas y scores para la mitad, con generate_series (en SQL). */
async function seedVolume(client: pg.Client, total: number): Promise<void> {
  await client.query(
    'TRUNCATE ml.prediction_model_results, ml.prediction_runs, ml.booking_feature_snapshots RESTART IDENTITY CASCADE',
  );
  await client.query('TRUNCATE analytics.appointment_outcomes');
  await client.query(
    `INSERT INTO analytics.appointment_outcomes (appointment_id, client_id, clinic_id, appointment_at, created_at_source,
      outcome, classification_detail, outcome_rule_version, classification_cutoff_at)
    SELECT 800000000000000 + g, 810000000000000 + (g % 5000), 1 + (g % 17),
           timestamptz '2026-11-01 13:00:00+00' + make_interval(mins => (g * 7) % (60 * 24 * 85)),
           timestamptz '2026-10-01 13:00:00+00', 'FUTURE', 'FUTURE_PENDING', 'FLOW_NO_SHOW_V1', now()
    FROM generate_series(1, $1::int) g`,
    [total],
  );
  await client.query(`INSERT INTO ml.booking_feature_snapshots (reservation_id, client_id, snapshot_type, prediction_at, appointment_at,
      feature_version, builder_version, snapshot_hash, features, evidence_source)
    SELECT appointment_id, client_id, 'booking_creation', created_at_source, appointment_at, 'BOOKING_BASELINE_V1',
           'risk_features_builder_v1', md5(appointment_id::text) || md5(appointment_id::text || 'x'), '{}'::jsonb, 'SYNTHETIC_DEMO_ONLY'
    FROM analytics.appointment_outcomes WHERE appointment_id % 2 = 0`);
  await client.query(`INSERT INTO ml.prediction_runs (run_uid, snapshot_id, reservation_id, mode, requested_model_keys, request_id, run_requested_at, completed_at, ml_latency_ms)
    SELECT gen_random_uuid(), snapshot_id, reservation_id, 'compare', ARRAY['random_forest_full_v1','xgboost_full_v1'], 'perf', now(), now(), 10
    FROM ml.booking_feature_snapshots`);
  await client.query(`INSERT INTO ml.prediction_model_results (run_id, snapshot_id, reservation_id, model_key, algorithm, model_version, model_hash,
      feature_version, prediction_at, scored_at, probability_no_show, prediction_target, validation_status, calibration_status)
    SELECT r.run_id, r.snapshot_id, r.reservation_id, m.key, m.alg, m.key || ':abc123def456', 'abc123def456', 'BOOKING_BASELINE_V1',
           now(), now(), ((r.reservation_id * 7919) % 1000) / 1000.0, 'NO_SHOW_CANDIDATE', 'EXPLORATORY_NOT_VALIDATED', 'not_operationally_validated'
    FROM ml.prediction_runs r
    CROSS JOIN (VALUES ('random_forest_full_v1', 'random_forest'), ('xgboost_full_v1', 'xgboost')) AS m(key, alg)`);
  await client.query(
    'ANALYZE analytics.appointment_outcomes; ANALYZE ml.prediction_model_results; ANALYZE ml.booking_feature_snapshots; ANALYZE ml.prediction_runs',
  );
}

async function seedHistory(client: pg.Client, clientId: string, events: number): Promise<void> {
  if (events === 0) return;
  await client.query(
    `INSERT INTO analytics.ml_history_cumulative_v1 (appointment_id, client_id, known_at, event_kind,
      prior_including_event_attended, prior_including_event_no_show, last_attended_at, last_no_show_at)
    SELECT 820000000000000 + ($2::bigint % 1000) * 1000000 + g, $2::bigint,
           timestamptz '2020-01-01 00:00:00+00' + make_interval(mins => g), (g % 4 = 0)::int,
           g - g / 4, g / 4, timestamptz '2020-01-01 00:00:00+00' + make_interval(mins => g), NULL
    FROM generate_series(1, $1::int) g`,
    [events, clientId],
  );
}

describe('Benchmark Sprint 01 (laboratorio, datos sintéticos)', { skip: skip ?? false }, () => {
  let client: pg.Client;
  let sequelize: Sequelize;
  let app: FastifyInstance;
  let statementCount = 0;
  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model,
      cpus: os.cpus().length,
      memoryGb: Math.round(os.totalmem() / 1024 ** 3),
      database: 'PostgreSQL 18.4 (docker, tmpfs, depi_noshow_test)',
      note: 'Medición local de laboratorio; NO es SLA ni representa producción.',
    },
  };

  before(async () => {
    await resetTestDatabase();
    client = await connectPg();
    await client.query(
      `INSERT INTO raw_flow.x_config_clinics ("ClinicID") SELECT g FROM generate_series(1, 17) g`,
    );
    sequelize = createTestSequelize({ logging: () => void (statementCount += 1) });
    const config = createPredictiveConfig(
      EnvironmentSchema.parse({
        ...process.env,
        DATA_SOURCE_MODE: 'SYNTHETIC_DEMO_ONLY',
        INTERNAL_API_KEY_SHA256: sha256Hex(TEST_INTERNAL_API_KEY),
      }),
    );
    app = buildApp({
      postgresHealthCheck: healthyCheck,
      mysqlHealthCheck: null,
      loggerInstance: pino({ level: 'silent' }) as unknown as FastifyBaseLogger,
      predictiveApi: {
        internalApiKeySha256: sha256Hex(TEST_INTERNAL_API_KEY),
        dependencies: {
          ...createPredictiveDependencies(config, sequelize, new FakePredictionClient()),
          clock: new FixedClock(new Date('2026-10-25T00:00:00Z')),
        },
      },
    });
  });

  after(async () => {
    await app?.close();
    await sequelize?.close();
    await client?.end();
    const directory = path.join(path.resolve(fixturePath('.'), '..'), 'reports/performance');
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `sprint01-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`[performance] reporte: ${path.relative(process.cwd(), file)}`);
  });

  it('listado: 1k/10k/100k reservas × limit 1/25/100 × orden cronológico/probabilidad', async () => {
    const results: Record<string, unknown>[] = [];
    for (const volume of [1_000, 10_000, 100_000]) {
      await seedVolume(client, volume);
      for (const limit of [1, 25, 100]) {
        for (const sort of ['appointmentAt', 'probabilityNoShow']) {
          const url = `/api/v1/reservations?from=2026-11-01&to=2027-01-24&limit=${limit}&sort=${sort}&direction=desc`;
          let bytes = 0;
          statementCount = 0;
          const latency = await measure(30, 5, async () => {
            const response = await app.inject({ method: 'GET', url, headers: AUTH_HEADERS });
            assert.equal(response.statusCode, 200);
            bytes = response.body.length;
          });
          results.push({
            volume,
            limit,
            sort,
            latencyMs: latency,
            responseBytes: bytes,
            sqlStatementsPerRequest: statementCount / 35,
          });
        }
      }
    }
    report.listReservations = results;
    report.rssMbAfterList = Math.round(process.memoryUsage().rss / 1024 ** 2);
    console.log(JSON.stringify(results.filter((r) => r.limit === 25)));
  });

  it('EXPLAIN (ANALYZE, BUFFERS) del listado sobre 100k sintéticas', async () => {
    const plan = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT o.appointment_id, sel.probability_no_show FROM analytics.appointment_outcomes o
      LEFT JOIN LATERAL (SELECT r.probability_no_show FROM ml.prediction_model_results r
        JOIN ml.booking_feature_snapshots s ON s.snapshot_id = r.snapshot_id AND s.evidence_source = 'SYNTHETIC_DEMO_ONLY'
        WHERE r.reservation_id = o.appointment_id AND r.model_key = 'random_forest_full_v1'
        ORDER BY r.scored_at DESC, r.result_id DESC LIMIT 1) sel ON true
      WHERE o.outcome = 'FUTURE' AND o.appointment_at >= '2026-11-01T05:00Z' AND o.appointment_at < '2027-01-25T05:00Z'
      ORDER BY sel.probability_no_show DESC NULLS LAST, o.appointment_at, o.appointment_id LIMIT 26`);
    const text = plan.rows.map((row) => row['QUERY PLAN']).join('\n');
    report.listPlanProbabilitySort = text;
    assert.match(text, /idx_prediction_results_reservation_model|Index/);
  });

  it('historial as-of: 0, 1, 1k y 100k eventos del cliente (agregación indexada, sin traer filas)', async () => {
    const repository = new SequelizeClientHistoryRepository(sequelize, 5000);
    const results: Record<string, unknown>[] = [];
    for (const [index, events] of [0, 1, 1_000, 100_000].entries()) {
      const clientId = String(830000000000000 + index);
      await seedHistory(client, clientId, events);
      await client.query('ANALYZE analytics.ml_history_cumulative_v1');
      const latency = await measure(50, 5, () =>
        repository.summarizeAsOf(clientId, new Date('2030-01-01T00:00:00Z')),
      );
      const summary = await repository.summarizeAsOf(clientId, new Date('2030-01-01T00:00:00Z'));
      assert.equal(summary.previousAttended + summary.previousNoShow, events);
      results.push({ events, latencyMs: latency });
    }
    const plan =
      await client.query(`EXPLAIN (ANALYZE, BUFFERS) SELECT 1 FROM analytics.ml_history_cumulative_v1 h
      WHERE h.client_id = 830000000000003 AND h.known_at < '2030-01-01Z' ORDER BY h.known_at DESC, h.appointment_id DESC LIMIT 1`);
    report.historyAsOf = results;
    report.historyPlan100k = plan.rows.map((row) => row['QUERY PLAN']).join('\n');
    console.log(JSON.stringify(results));
  });

  it(
    'HTTP a Python real: single RF/XGB, compare, explain RF/XGB y concurrencia 1/2/5/10',
    { skip: realMl ? false : 'SKIP: requiere ML_RUN_REAL_INTEGRATION=1 + ML_REAL_SERVICE_URL/KEY' },
    async () => {
      const config = createPredictiveConfig(
        EnvironmentSchema.parse({
          ...process.env,
          ML_SERVICE_URL: process.env.ML_REAL_SERVICE_URL,
          ML_SERVICE_KEY: process.env.ML_REAL_SERVICE_KEY,
          ML_EXPLAIN_TIMEOUT_MS: '30000',
          ML_MAX_QUEUED_REQUESTS: '16',
        }),
      );
      const ml: MlPredictionClient = createMlPredictionClient(config.ml, {
        info: () => undefined,
        warn: () => undefined,
      });
      const request = loadJsonFixture<{ request: MlCompareRequest }>(
        'fixtures/ml/synthetic_compare_request.json',
      ).request;
      const ctx = { requestId: 'perf' };
      const ml_ = {
        predictRf: await measure(30, 3, () =>
          ml.predict({ ...request, model_key: 'random_forest_full_v1' }, ctx),
        ),
        predictXgb: await measure(30, 3, () =>
          ml.predict({ ...request, model_key: 'xgboost_full_v1' }, ctx),
        ),
        compare: await measure(30, 3, () => ml.compare(request, ctx)),
        explainRf: await measure(10, 1, () =>
          ml.explain({ ...request, model_key: 'random_forest_full_v1', top_k: 5 }, ctx),
        ),
        explainXgb: await measure(20, 2, () =>
          ml.explain({ ...request, model_key: 'xgboost_full_v1', top_k: 5 }, ctx),
        ),
      };
      const concurrency: Record<string, unknown>[] = [];
      for (const parallel of [1, 2, 5, 10]) {
        const outcomes: Record<string, number> = {};
        const start = performance.now();
        await Promise.all(
          Array.from({ length: parallel * 5 }, async () => {
            try {
              await ml.compare(request, ctx);
              outcomes.ok = (outcomes.ok ?? 0) + 1;
            } catch (error) {
              const code = String((error as { code?: string }).code ?? 'UNKNOWN');
              outcomes[code] = (outcomes[code] ?? 0) + 1;
            }
          }),
        );
        concurrency.push({
          parallelRequests: parallel * 5,
          wallMs: Math.round(performance.now() - start),
          outcomes,
        });
      }
      report.mlHttp = {
        latencyMs: ml_,
        concurrencyCompare: concurrency,
        limits: { nodeMaxConcurrent: 2, nodeMaxQueued: 16, pythonMaxConcurrent: 2 },
      };
      console.log(JSON.stringify(report.mlHttp));
    },
  );
});
