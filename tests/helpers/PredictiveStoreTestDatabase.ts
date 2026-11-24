import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { PredictiveAppDatabaseConfig } from '../../src/infrastructure/database/postgres/PredictiveAppDatabase.js';
import {
  loadPredictiveAppMigrations,
  PredictiveAppMigrationRunner,
} from '../../src/infrastructure/database/postgres/PredictiveAppMigrationRunner.js';
import type { DataSourceMode } from '../../src/shared/data/DataSourceMode.js';
import { testDatabaseConfig } from './TestDatabase.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PREDICTIVE_APP_MIGRATIONS_DIR = path.join(ROOT, 'migrations/postgres/predictive_app');
const ROLES_SQL = path.join(PREDICTIVE_APP_MIGRATIONS_DIR, 'provisioning/roles.sql');

/** Credenciales SOLO de la base de prueba efímera (tmpfs); nunca válidas en otro entorno. */
export const TEST_MIGRATOR = { user: 'noshow_app_migrator', password: 'test_only_migrator_pw' };
export const TEST_RUNTIME = { user: 'noshow_app_runtime', password: 'test_only_runtime_pw' };

const STORE_DATABASE = /^depi_noshow_test_store_[a-z0-9]{12}$/;

export interface IsolatedStoreDatabase {
  readonly name: string;
  /** Conexión del rol RUNTIME restringido (la que usa la app). */
  readonly runtime: PredictiveAppDatabaseConfig;
  /** Cliente del rol migrador o superusuario de prueba sobre esta base (verificaciones). */
  connect(role: 'migrator' | 'admin' | 'runtime'): Promise<pg.Client>;
  drop(): Promise<void>;
}

function adminConfig(database: string): pg.ClientConfig {
  const base = testDatabaseConfig();
  return { ...base, database, connectionTimeoutMillis: 3000 };
}

/** Ejecuta el roles.sql REAL sustituyendo las variables psql por valores de prueba. */
async function provision(admin: pg.Client, database: string): Promise<void> {
  const script = (await readFile(ROLES_SQL, 'utf8'))
    .replace(/--[^\n]*/g, '')
    .replaceAll(':migrator_password', `'${TEST_MIGRATOR.password}'`)
    .replaceAll(':runtime_password', `'${TEST_RUNTIME.password}'`)
    .replaceAll(':"DBNAME"', `"${database}"`);
  for (const statement of script
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)) {
    try {
      await admin.query(statement);
    } catch (error) {
      const code = (error as { code?: string }).code;
      // Roles de clúster ya creados por otra suite (o en paralelo): se reutilizan.
      const roleExists = /^CREATE ROLE/i.test(statement) && (code === '42710' || code === '23505');
      if (!roleExists) throw error;
    }
  }
}

/**
 * Base PostgreSQL de PRUEBA nueva y desechable por suite (en el contenedor tmpfs de
 * docker-compose.test.yml): schema ml, roles aprovisionados con el script real, migraciones
 * aplicadas por el rol MIGRADOR (no superusuario) e identidad ligada al modo indicado.
 */
export async function createIsolatedStoreDatabase(
  mode: DataSourceMode,
  options: { migrate?: boolean; bind?: boolean } = {},
): Promise<IsolatedStoreDatabase> {
  const maintenance = testDatabaseConfig();
  const name = `depi_noshow_test_store_${randomBytes(6).toString('hex')}`;
  const root = new pg.Client(adminConfig(maintenance.database));
  await root.connect();
  try {
    await root.query(`CREATE DATABASE "${name}"`);
  } finally {
    await root.end();
  }

  const admin = new pg.Client(adminConfig(name));
  await admin.connect();
  try {
    await admin.query('CREATE SCHEMA ml');
    await provision(admin, name);
  } finally {
    await admin.end();
  }

  const connect = async (role: 'migrator' | 'admin' | 'runtime'): Promise<pg.Client> => {
    const credentials =
      role === 'migrator' ? TEST_MIGRATOR : role === 'runtime' ? TEST_RUNTIME : null;
    const client = new pg.Client({ ...adminConfig(name), ...(credentials ?? {}) });
    await client.connect();
    return client;
  };

  if (options.migrate !== false) {
    const migrator = await connect('migrator');
    try {
      const runner = new PredictiveAppMigrationRunner(
        migrator,
        await loadPredictiveAppMigrations(PREDICTIVE_APP_MIGRATIONS_DIR),
      );
      await runner.up();
      if (options.bind !== false) await runner.bindIdentity(mode);
    } finally {
      await migrator.end();
    }
  }

  return {
    name,
    runtime: {
      host: maintenance.host,
      port: maintenance.port,
      database: name,
      user: TEST_RUNTIME.user,
      password: TEST_RUNTIME.password,
      poolMax: 5,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 1000,
      statementTimeoutMs: 5000,
    },
    connect,
    async drop() {
      if (!STORE_DATABASE.test(name)) throw new Error('Guarda: solo bases de prueba desechables');
      const client = new pg.Client(adminConfig(maintenance.database));
      await client.connect();
      try {
        await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await client.end();
      }
    },
  };
}
