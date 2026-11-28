import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  loadPredictiveAppMigrations,
  PREDICTIVE_APP_SCHEMA_VERSION,
  PredictiveAppMigrationError,
  PredictiveAppMigrationRunner,
} from '../../../../src/infrastructure/database/postgres/PredictiveAppMigrationRunner.js';
import {
  createIsolatedStoreDatabase,
  PREDICTIVE_APP_MIGRATIONS_DIR,
} from '../../../helpers/PredictiveStoreTestDatabase.js';
import { reportSkipped } from '../../../helpers/ReportSkipped.js';
import { probeTestDatabase } from '../../../helpers/TestDatabase.js';

const skip = await probeTestDatabase();
reportSkipped('PredictiveAppMigrations', skip);
const scratch = mkdtempSync(path.join(os.tmpdir(), 'nsp-migrations-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

describe(
  'Runner de migraciones del almacén (solo up, aditivo) sobre BD de PRUEBA',
  { skip: skip ?? false },
  () => {
    it('aplica 001–003 con el rol migrador, es idempotente y deja tablas ml.app_* con checksum', async () => {
      const database = await createIsolatedStoreDatabase('READ_ONLY_EXISTING_SCHEDULE', {
        migrate: false,
      });
      const migrator = await database.connect('migrator');
      try {
        const migrations = await loadPredictiveAppMigrations(PREDICTIVE_APP_MIGRATIONS_DIR);
        const runner = new PredictiveAppMigrationRunner(migrator, migrations);
        assert.deepEqual(await runner.up(), ['001', '002', '003']);
        assert.deepEqual(await runner.up(), [], 'segunda ejecución sin cambios');
        assert.equal(await runner.bindIdentity('READ_ONLY_EXISTING_SCHEDULE'), 'BOUND');
        assert.equal(await runner.bindIdentity('READ_ONLY_EXISTING_SCHEDULE'), 'ALREADY_BOUND');
        await assert.rejects(
          runner.bindIdentity('SYNTHETIC_DEMO_ONLY'),
          PredictiveAppMigrationError,
        );

        const tables = await migrator.query<{ relname: string }>(
          `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'ml' AND c.relkind = 'r' ORDER BY 1`,
        );
        assert.deepEqual(tables.rows.map((row) => row.relname).sort(), [
          'app_attendance_outcomes',
          'app_attendance_prediction_comparisons',
          'app_booking_feature_snapshots',
          'app_imported_reservations',
          'app_overbooking_authorizations',
          'app_prediction_model_results',
          'app_prediction_runs',
          'app_predictive_store_identity',
          'app_predictive_store_migrations',
          'app_reservation_import_batches',
          'app_reservation_import_rejections',
          'app_retention_contacts',
          'app_space_recovery_outcomes',
        ]);
        const history = await migrator.query<{
          version: string;
          checksum: string;
          applied_by: string;
        }>(
          'SELECT version, checksum, applied_by FROM ml.app_predictive_store_migrations ORDER BY version',
        );
        assert.deepEqual(
          history.rows.map((row) => row.version),
          ['001', '002', PREDICTIVE_APP_SCHEMA_VERSION],
        );
        assert.deepEqual(
          history.rows.map((row) => row.checksum),
          migrations.map((m) => m.checksum),
        );
        assert.ok(history.rows.every((row) => row.applied_by === 'noshow_app_migrator'));
      } finally {
        await migrator.end();
        await database.drop();
      }
    });

    it('checksum alterado de una migración aplicada ⇒ error, sin aplicar nada', async () => {
      const database = await createIsolatedStoreDatabase('READ_ONLY_EXISTING_SCHEDULE');
      const migrator = await database.connect('migrator');
      try {
        const migrations = await loadPredictiveAppMigrations(PREDICTIVE_APP_MIGRATIONS_DIR);
        const tampered = migrations.map((m, i) =>
          i === 0 ? { ...m, checksum: 'f'.repeat(64) } : m,
        );
        await assert.rejects(
          new PredictiveAppMigrationRunner(migrator, tampered).plan(),
          /Checksum distinto/,
        );
      } finally {
        await migrator.end();
        await database.drop();
      }
    });

    it('colisión con un objeto preexistente ⇒ aborta antes de crear nada (no se reemplaza)', async () => {
      const database = await createIsolatedStoreDatabase('READ_ONLY_EXISTING_SCHEDULE', {
        migrate: false,
      });
      const admin = await database.connect('admin');
      const migrator = await database.connect('migrator');
      try {
        await admin.query('CREATE TABLE ml.app_prediction_runs (preexisting int)');
        await admin.query('INSERT INTO ml.app_prediction_runs VALUES (42)');
        const runner = new PredictiveAppMigrationRunner(
          migrator,
          await loadPredictiveAppMigrations(PREDICTIVE_APP_MIGRATIONS_DIR),
        );
        await assert.rejects(runner.up(), /Colisión: ya existen ml\.app_prediction_runs/);
        const created = await admin.query(
          `SELECT to_regclass('ml.app_booking_feature_snapshots') AS t`,
        );
        assert.equal(created.rows[0]?.t, null, 'nada creado');
        const preserved = await admin.query('SELECT preexisting FROM ml.app_prediction_runs');
        assert.deepEqual(
          preserved.rows,
          [{ preexisting: 42 }],
          'el objeto ajeno y sus filas quedan intactos',
        );
      } finally {
        await admin.end();
        await migrator.end();
        await database.drop();
      }
    });

    it('el cargador rechaza migraciones no aditivas antes de conectarse a ninguna base', async () => {
      const directory = mkdtempSync(path.join(scratch, 'bad-'));
      writeFileSync(path.join(directory, '001_bad.sql'), 'DROP TABLE ml.app_prediction_runs;');
      await assert.rejects(loadPredictiveAppMigrations(directory), /no es aditiva: DROP/);
      const alter = mkdtempSync(path.join(scratch, 'alter-'));
      writeFileSync(
        path.join(alter, '001_alter.sql'),
        'ALTER TABLE ml.prediction_runs ADD COLUMN x int;',
      );
      await assert.rejects(loadPredictiveAppMigrations(alter), /ALTER/);
    });
  },
);
