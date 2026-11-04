import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import type { DataSourceMode } from '../../../shared/data/DataSourceMode.js';
import { additiveMigrationViolations, createdObjects } from './AdditiveMigrationGuard.js';

/** Versión de esquema que el runtime exige (última migración de migrations/postgres/predictive_app). */
export const PREDICTIVE_APP_SCHEMA_VERSION = '002';
export const PREDICTIVE_APP_MIGRATIONS_TABLE = 'ml.app_predictive_store_migrations';

const MIGRATION_FILE = /^(\d{3})_([a-z0-9_]+)\.sql$/;

export interface PredictiveAppMigration {
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface PredictiveAppMigrationPlan {
  readonly databaseName: string;
  readonly applied: readonly string[];
  readonly pending: readonly PredictiveAppMigration[];
}

export class PredictiveAppMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PredictiveAppMigrationError';
  }
}

export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/** Carga SOLO archivos `NNN_nombre.sql` (sin down); rechaza cualquier migración no aditiva. */
export async function loadPredictiveAppMigrations(
  directory: string,
): Promise<PredictiveAppMigration[]> {
  const files = (await readdir(directory)).filter((file) => MIGRATION_FILE.test(file)).sort();
  const migrations: PredictiveAppMigration[] = [];
  for (const file of files) {
    const [, version, name] = MIGRATION_FILE.exec(file) ?? [];
    if (!version || !name) continue;
    if (migrations.some((migration) => migration.version === version)) {
      throw new PredictiveAppMigrationError(`Versión duplicada ${version}`);
    }
    const sql = await readFile(path.join(directory, file), 'utf8');
    const violations = additiveMigrationViolations(sql);
    if (violations.length > 0) {
      throw new PredictiveAppMigrationError(
        `La migración ${version} no es aditiva: ${violations.join(', ')}`,
      );
    }
    migrations.push({ version, name, sql, checksum: migrationChecksum(sql) });
  }
  return migrations;
}

/**
 * Runner restringido del almacén predictivo (ADR-008): solo `up`, transaccional por migración,
 * checksum inmutable, `lock_timeout` corto, preflight de colisiones (nunca `IF NOT EXISTS`) y
 * verificación posterior de los objetos creados. Historial en tabla propia nueva; no edita
 * `ml.app_schema_migrations` (runner heredado). No existe operación down.
 */
export class PredictiveAppMigrationRunner {
  constructor(
    private readonly client: pg.Client,
    private readonly migrations: readonly PredictiveAppMigration[],
  ) {}

  async plan(): Promise<PredictiveAppMigrationPlan> {
    const databaseName = await this.scalar<string>('SELECT current_database() AS value');
    const applied = await this.appliedRows();
    const known = new Map(this.migrations.map((migration) => [migration.version, migration]));

    for (const row of applied) {
      const migration = known.get(row.version);
      if (!migration) {
        throw new PredictiveAppMigrationError(`Migración aplicada ${row.version} desconocida`);
      }
      if (migration.checksum !== row.checksum) {
        throw new PredictiveAppMigrationError(`Checksum distinto en la migración ${row.version}`);
      }
    }
    const appliedSet = new Set(applied.map((row) => row.version));
    return {
      databaseName,
      applied: applied.map((row) => row.version),
      pending: this.migrations.filter((migration) => !appliedSet.has(migration.version)),
    };
  }

  async up(): Promise<string[]> {
    const plan = await this.plan();
    await this.assertNoCollisions(plan.pending);
    if (!(await this.historyExists())) {
      await this.inTransaction(async () => {
        await this.client.query(`CREATE TABLE ${PREDICTIVE_APP_MIGRATIONS_TABLE} (
          version    text PRIMARY KEY CHECK (version ~ '^[0-9]{3}$'),
          name       text NOT NULL,
          checksum   char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
          applied_by text NOT NULL DEFAULT current_user,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`);
      });
    }

    const appliedNow: string[] = [];
    for (const migration of plan.pending) {
      await this.inTransaction(async () => {
        await this.client.query(`SET LOCAL lock_timeout = '5s'`);
        await this.client.query(`SET LOCAL statement_timeout = '120s'`);
        await this.client.query(migration.sql);
        await this.client.query(
          `INSERT INTO ${PREDICTIVE_APP_MIGRATIONS_TABLE} (version, name, checksum) VALUES ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum],
        );
        await this.assertCreated(migration);
      });
      appliedNow.push(migration.version);
    }
    return appliedNow;
  }

  /** Liga la base a un modo de datos (una sola vez). Un modo distinto aborta: nunca se mezclan. */
  async bindIdentity(mode: DataSourceMode): Promise<'BOUND' | 'ALREADY_BOUND'> {
    const inserted = await this.client.query(
      `INSERT INTO ml.app_predictive_store_identity (identity_key, store_name, data_source_mode)
       VALUES ('predictive_store', 'no-show-predictive-store', $1)
       ON CONFLICT (identity_key) DO NOTHING`,
      [mode],
    );
    const bound = await this.scalar<string>(
      `SELECT data_source_mode AS value FROM ml.app_predictive_store_identity`,
    );
    if (bound !== mode) {
      throw new PredictiveAppMigrationError(`La base está ligada al modo ${bound}, no a ${mode}`);
    }
    return inserted.rowCount === 1 ? 'BOUND' : 'ALREADY_BOUND';
  }

  private async assertNoCollisions(pending: readonly PredictiveAppMigration[]): Promise<void> {
    const collisions: string[] = [];
    for (const migration of pending) {
      const objects = createdObjects(migration.sql);
      for (const table of objects.tables) {
        const exists = await this.scalar<boolean>('SELECT to_regclass($1) IS NOT NULL AS value', [
          table,
        ]);
        if (exists) collisions.push(table);
      }
      for (const fn of objects.functions) {
        const exists = await this.scalar<boolean>(
          `SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname || '.' || p.proname = $1) AS value`,
          [fn],
        );
        if (exists) collisions.push(fn);
      }
    }
    if (collisions.length > 0) {
      throw new PredictiveAppMigrationError(
        `Colisión: ya existen ${collisions.join(', ')}; no se reemplaza nada`,
      );
    }
  }

  private async assertCreated(migration: PredictiveAppMigration): Promise<void> {
    for (const table of createdObjects(migration.sql).tables) {
      const exists = await this.scalar<boolean>('SELECT to_regclass($1) IS NOT NULL AS value', [
        table,
      ]);
      if (!exists) {
        throw new PredictiveAppMigrationError(`Verificación: ${table} no quedó creada`);
      }
    }
  }

  private async historyExists(): Promise<boolean> {
    return this.scalar<boolean>('SELECT to_regclass($1) IS NOT NULL AS value', [
      PREDICTIVE_APP_MIGRATIONS_TABLE,
    ]);
  }

  private async appliedRows(): Promise<{ version: string; checksum: string }[]> {
    if (!(await this.historyExists())) return [];
    const result = await this.client.query<{ version: string; checksum: string }>(
      `SELECT version, checksum FROM ${PREDICTIVE_APP_MIGRATIONS_TABLE} ORDER BY version`,
    );
    return result.rows;
  }

  private async scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
    const result = await this.client.query<{ value: T }>(sql, params);
    return result.rows[0]?.value as T;
  }

  private async inTransaction(work: () => Promise<void>): Promise<void> {
    await this.client.query('BEGIN');
    try {
      await work();
      await this.client.query('COMMIT');
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }
}
