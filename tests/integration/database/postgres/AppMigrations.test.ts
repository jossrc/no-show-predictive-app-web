import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import {
  AppMigrationRunner,
  loadAppMigrations,
} from '../../../../src/infrastructure/database/migrations/AppMigrationRunner.js';
import {
  APP_MIGRATIONS_DIR,
  connectPg,
  probeTestDatabase,
  resetTestDatabase,
} from '../../../helpers/TestDatabase.js';
import { reportSkipped } from '../../../helpers/ReportSkipped.js';

const skip = await probeTestDatabase();

describe('Migraciones app (schema ml) sobre BD de PRUEBA efímera', { skip: skip ?? false }, () => {
  let client: pg.Client;
  let runner: AppMigrationRunner;

  before(async () => {
    await resetTestDatabase({ migrate: false });
    client = await connectPg();
    runner = new AppMigrationRunner(client, await loadAppMigrations(APP_MIGRATIONS_DIR));
  });
  after(async () => client?.end());

  it('dry-run (plan) no escribe; up aplica 001 y es idempotente', async () => {
    const plan = await runner.plan();
    assert.deepEqual(
      plan.pending.map((m) => m.version),
      ['001'],
    );
    const before = await client.query(`SELECT to_regclass('ml.app_schema_migrations') AS t`);
    assert.equal(before.rows[0].t, null, 'plan no crea tablas');
    assert.deepEqual(await runner.up(), ['001']);
    assert.deepEqual(await runner.up(), []);
    const tables = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='ml' ORDER BY 1`,
    );
    assert.deepEqual(
      tables.rows.map((r) => r.table_name),
      [
        'app_schema_migrations',
        'booking_feature_snapshots',
        'prediction_model_results',
        'prediction_runs',
      ],
    );
  });

  it('constraints: probabilidad 0..1, uso operativo bloqueado, nivel solo con política aprobada, sin default LOW', async () => {
    await client.query(`INSERT INTO ml.booking_feature_snapshots (reservation_id, client_id, snapshot_type, prediction_at, appointment_at,
      feature_version, builder_version, snapshot_hash, features, evidence_source)
      VALUES (1, 1, 'booking_creation', '2026-10-01Z', '2026-11-01Z', 'BOOKING_BASELINE_V1', 'b1', repeat('a', 64), '{}', 'SYNTHETIC_DEMO_ONLY')`);
    await client.query(`INSERT INTO ml.prediction_runs (run_uid, snapshot_id, reservation_id, mode, requested_model_keys, request_id, run_requested_at, completed_at, ml_latency_ms)
      VALUES (gen_random_uuid(), 1, 1, 'single', ARRAY['random_forest_full_v1'], 'r1', now(), now(), 1)`);
    const insert = (overrides: string) =>
      client.query(`INSERT INTO ml.prediction_model_results (run_id, snapshot_id, reservation_id, model_key, algorithm, model_version, model_hash,
        feature_version, prediction_at, scored_at, probability_no_show, prediction_target, validation_status, calibration_status, operational_use_allowed, risk_level, risk_policy_version, risk_policy_status)
        SELECT 1, 1, 1, 'random_forest_full_v1', 'random_forest', 'v1', 'abcdef', 'BOOKING_BASELINE_V1', now(), now(), p, 'NO_SHOW_CANDIDATE', 'X', 'Y', op, lvl, ver, st
        FROM (SELECT ${overrides}) AS v(p, op, lvl, ver, st)`);

    await assert.rejects(
      insert(`1.5::float8, false, NULL::text, NULL::text, 'pending_validation'`),
      /check/i,
    );
    await assert.rejects(
      insert(`0.5::float8, true, NULL::text, NULL::text, 'pending_validation'`),
      /check/i,
    );
    await assert.rejects(
      insert(`0.5::float8, false, 'LOW', NULL::text, 'pending_validation'`),
      /check/i,
    );
    await assert.rejects(insert(`0.5::float8, false, 'LOW', 'p1', 'pending_validation'`), /check/i);
    await insert(`0.5::float8, false, NULL::text, NULL::text, 'pending_validation'`);
    const row = await client.query(
      `SELECT risk_level, operational_use_allowed FROM ml.prediction_model_results`,
    );
    assert.deepEqual(row.rows[0], { risk_level: null, operational_use_allowed: false });
    await assert.rejects(
      insert(`0.6::float8, false, NULL::text, NULL::text, 'pending_validation'`),
      /duplicate key|unique/i,
    );
  });

  it('registros inmutables: UPDATE bloqueado por trigger en snapshots, runs y resultados', async () => {
    for (const table of [
      'booking_feature_snapshots',
      'prediction_runs',
      'prediction_model_results',
    ]) {
      await assert.rejects(
        client.query(`UPDATE ml.${table} SET reservation_id = reservation_id`),
        /inmutables/,
        table,
      );
    }
  });

  it('down solo con confirmación exacta en base desechable; revierte sin tocar raw_flow/analytics', async () => {
    await assert.rejects(runner.downLatest('otra_base'), /confirm-database/);
    const name = (await client.query(`SELECT current_database() AS n`)).rows[0].n as string;
    assert.equal(await runner.downLatest(name), '001');
    const remaining = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='ml' AND table_name <> 'app_schema_migrations'`,
    );
    assert.equal(remaining.rows[0].n, 0);
    const sources = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema IN ('raw_flow','analytics')`,
    );
    assert.ok(sources.rows[0].n >= 12);
    assert.deepEqual(await runner.up(), ['001']);
  });
});
reportSkipped('AppMigrations', skip);
