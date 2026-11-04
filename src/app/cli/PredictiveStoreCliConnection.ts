import pg from 'pg';
import { Environment } from '../../config/environment/Environment.js';
import { POSTGRES_READ_ONLY_SESSION_OPTIONS } from '../../infrastructure/database/sequelize/postgres/ReadOnlySqlGuard.js';

/**
 * Conexión de las CLIs del almacén predictivo PostgreSQL (ADR-008). La base destino es la de la
 * app (APP_DB_*); el rol depende del uso:
 * - migrador (store:migrate): APP_DB_MIGRATOR_USER_POSTGRES / APP_DB_MIGRATOR_PASS_POSTGRES, que
 *   NUNCA forman parte de la configuración del proceso runtime;
 * - runtime (store:status, store:import-legacy): APP_DB_USER_POSTGRES (SELECT/INSERT).
 * readOnly=true abre la sesión con default_transaction_read_only=on (dry-run / status).
 */
export function predictiveStoreClient(role: 'migrator' | 'runtime', readOnly: boolean): pg.Client {
  const user =
    role === 'migrator'
      ? process.env.APP_DB_MIGRATOR_USER_POSTGRES
      : Environment.APP_DB_USER_POSTGRES;
  const password =
    role === 'migrator'
      ? process.env.APP_DB_MIGRATOR_PASS_POSTGRES
      : Environment.APP_DB_PASS_POSTGRES;
  const missing = [
    ['APP_DB_HOST_POSTGRES', Environment.APP_DB_HOST_POSTGRES],
    ['APP_DB_NAME_POSTGRES', Environment.APP_DB_NAME_POSTGRES],
    [role === 'migrator' ? 'APP_DB_MIGRATOR_USER_POSTGRES' : 'APP_DB_USER_POSTGRES', user],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) throw new Error(`Faltan variables: ${missing.join(', ')}`);

  return new pg.Client({
    host: Environment.APP_DB_HOST_POSTGRES,
    port: Environment.APP_DB_PORT_POSTGRES,
    database: Environment.APP_DB_NAME_POSTGRES,
    user,
    password: password ?? '',
    connectionTimeoutMillis: Environment.DATABASE_CONNECTION_TIMEOUT_MS,
    application_name: `no-show-predictive-app-be (store-cli:${role})`,
    ...(readOnly ? { options: POSTGRES_READ_ONLY_SESSION_OPTIONS } : {}),
  });
}

/** Mensaje de error seguro para consola (sin SQL, credenciales ni stack). */
export function cliErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'desconocido';
}
