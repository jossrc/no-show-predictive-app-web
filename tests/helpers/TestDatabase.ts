import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { Sequelize } from 'sequelize-typescript';
import { fileURLToPath } from 'node:url';
import {
  AppMigrationRunner,
  loadAppMigrations,
} from '../../src/infrastructure/database/migrations/AppMigrationRunner.js';
import { fixturePath } from './LoadFixture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const APP_MIGRATIONS_DIR = path.join(ROOT, 'migrations/postgres/app');

export interface TestDatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

/** Configuración tomada de TestEnvironment (TEST_DB_*). Rechaza cualquier base no-test. */
export function testDatabaseConfig(): TestDatabaseConfig {
  const config = {
    host: process.env.DB_HOST_POSTGRES ?? '',
    port: Number(process.env.DB_PORT_POSTGRES),
    user: process.env.DB_USER_POSTGRES ?? '',
    password: process.env.DB_PASS_POSTGRES ?? '',
    database: process.env.DB_NAME_POSTGRES ?? '',
  };
  if (!/(^|[_-])test([_-]|$)/i.test(config.database) || config.database === 'depi-noshow-db') {
    throw new Error('Las pruebas de integración solo pueden usar una base de PRUEBA aislada');
  }
  return config;
}

export async function connectPg(): Promise<pg.Client> {
  const client = new pg.Client({ ...testDatabaseConfig(), connectionTimeoutMillis: 2000 });
  await client.connect();
  return client;
}

/** null si la BD de prueba no está levantada (las pruebas se reportan como SKIP, no PASS). */
export async function probeTestDatabase(): Promise<string | null> {
  try {
    const client = await connectPg();
    await client.end();
    return null;
  } catch {
    return 'SKIP: PostgreSQL de prueba no disponible (npm run test:db:up)';
  }
}

export function createTestSequelize(options: { logging?: (sql: string) => void } = {}): Sequelize {
  const config = testDatabaseConfig();
  return new Sequelize(config.database, config.user, config.password, {
    host: config.host,
    port: config.port,
    dialect: 'postgres',
    logging: options.logging ?? false,
    pool: { max: 5, min: 0, acquire: 5000, idle: 1000 },
    models: [],
  });
}

/**
 * Reconstruye la BD de PRUEBA: borra y recrea raw_flow/analytics/ml (solo aquí, con guarda de
 * nombre), aplica la estructura fuente y las migraciones app. Jamás se invoca contra la real.
 */
export async function resetTestDatabase(options: { migrate?: boolean } = {}): Promise<void> {
  const client = await connectPg();
  try {
    const name =
      (await client.query<{ db: string }>('SELECT current_database() AS db')).rows[0]?.db ?? '';
    testDatabaseConfig();
    if (!/test/i.test(name)) throw new Error('Guarda: base conectada no es de prueba');

    await client.query('DROP SCHEMA IF EXISTS ml CASCADE');
    await client.query('DROP SCHEMA IF EXISTS analytics CASCADE');
    await client.query('DROP SCHEMA IF EXISTS raw_flow CASCADE');
    await client.query(await readFile(fixturePath('fixtures/database/source-schema.sql'), 'utf8'));

    if (options.migrate !== false) {
      await new AppMigrationRunner(client, await loadAppMigrations(APP_MIGRATIONS_DIR)).up();
    }
  } finally {
    await client.end();
  }
}

export async function countRows(client: pg.Client, table: string): Promise<number> {
  if (!/^(raw_flow|analytics|ml)\.[a-z_0-9]+$/.test(table)) throw new Error('tabla no permitida');
  const result = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM ${table}`,
  );
  return Number(result.rows[0]?.total ?? 0);
}
