import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';

/** Solo bases con estos marcadores admiten `down` (nunca la base real con datos FLOWww). */
const DISPOSABLE_DATABASE_NAME = /(^|[_-])(test|synthetic|demo)([_-]|$)/i;
const MIGRATION_FILE = /^(\d{3})_([a-z0-9_]+)\.(up|down)\.sql$/;

export interface AppMigration {
  readonly version: string;
  readonly name: string;
  readonly upSql: string;
  readonly downSql: string | null;
  readonly checksum: string;
}

export interface MigrationPlan {
  readonly databaseName: string;
  readonly applied: readonly string[];
  readonly pending: readonly AppMigration[];
}

export async function loadAppMigrations(directory: string): Promise<AppMigration[]> {
  const files = (await readdir(directory)).filter((file) => MIGRATION_FILE.test(file)).sort();
  const byVersion = new Map<string, { name: string; up?: string; down?: string }>();

  for (const file of files) {
    const [, version, name, direction] = MIGRATION_FILE.exec(file) ?? [];
    if (!version || !name || !direction) continue;
    const entry = byVersion.get(version) ?? { name };
    const sql = await readFile(path.join(directory, file), 'utf8');
    if (direction === 'up') entry.up = sql;
    else entry.down = sql;
    byVersion.set(version, entry);
  }

  return [...byVersion.entries()].map(([version, entry]) => {
    if (!entry.up) throw new Error(`La migración ${version} no tiene archivo .up.sql`);
    return {
      version,
      name: entry.name,
      upSql: entry.up,
      downSql: entry.down ?? null,
      checksum: createHash('sha256').update(entry.up, 'utf8').digest('hex'),
    };
  });
}

/**
 * Runner de migraciones del schema propio `ml`. Aditivo, transaccional por migración, con
 * verificación de checksum y sin `sync()`. `down` exige base desechable y confirmación explícita.
 */
export class AppMigrationRunner {
  constructor(
    private readonly client: pg.Client,
    private readonly migrations: readonly AppMigration[],
  ) {}

  async plan(): Promise<MigrationPlan> {
    const databaseName = await this.currentDatabase();
    const applied = await this.appliedVersions();
    const byVersion = new Map(this.migrations.map((migration) => [migration.version, migration]));

    for (const row of applied) {
      const known = byVersion.get(row.version);
      if (known && known.checksum !== row.checksum) {
        throw new Error(`Checksum distinto para la migración aplicada ${row.version}`);
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
    await this.client.query(`CREATE SCHEMA IF NOT EXISTS ml`);
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS ml.app_schema_migrations (
        version    text PRIMARY KEY,
        name       text NOT NULL,
        checksum   char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const appliedNow: string[] = [];
    for (const migration of plan.pending) {
      await this.inTransaction(async () => {
        await this.client.query(`SET LOCAL lock_timeout = '15s'`);
        await this.client.query(migration.upSql);
        await this.client.query(
          `INSERT INTO ml.app_schema_migrations (version, name, checksum) VALUES ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum],
        );
      });
      appliedNow.push(migration.version);
    }
    return appliedNow;
  }

  async downLatest(confirmDatabase: string): Promise<string | null> {
    const plan = await this.plan();
    if (!DISPOSABLE_DATABASE_NAME.test(plan.databaseName)) {
      throw new Error('down solo se permite en bases desechables (test/synthetic/demo)');
    }
    if (confirmDatabase !== plan.databaseName) {
      throw new Error('--confirm-database no coincide con la base conectada');
    }

    const latest = plan.applied.at(-1);
    if (!latest) return null;
    const migration = this.migrations.find((candidate) => candidate.version === latest);
    if (!migration?.downSql) throw new Error(`La migración ${latest} no tiene .down.sql`);

    await this.inTransaction(async () => {
      await this.client.query(migration.downSql as string);
      await this.client.query(`DELETE FROM ml.app_schema_migrations WHERE version = $1`, [latest]);
    });
    return latest;
  }

  private async currentDatabase(): Promise<string> {
    const result = await this.client.query<{ name: string }>('SELECT current_database() AS name');
    return result.rows[0]?.name ?? '';
  }

  private async appliedVersions(): Promise<{ version: string; checksum: string }[]> {
    const exists = await this.client.query<{ present: boolean }>(
      `SELECT to_regclass('ml.app_schema_migrations') IS NOT NULL AS present`,
    );
    if (!exists.rows[0]?.present) return [];

    const result = await this.client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM ml.app_schema_migrations ORDER BY version',
    );
    return result.rows;
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
