import pg from 'pg';
import {
  PersistenceUnavailableException,
  type PersistenceUnavailableExceptionProps,
} from '../errors/PersistenceUnavailableException.js';
import { assertAppStoreSql } from './PredictiveAppSqlGuard.js';

/**
 * Conexión PostgreSQL PROPIA de la app (ADR-008), separada de la fuente de solo lectura
 * (`postgresSequelize`). Usa el rol runtime con privilegios mínimos (SELECT/INSERT en ml.app_*),
 * sentencias guardadas por PredictiveAppSqlGuard y transacciones cortas que nunca abarcan
 * llamadas de red (Python) ni lecturas de la fuente.
 */
export interface PredictiveAppDatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly poolMax: number;
  readonly connectionTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly statementTimeoutMs: number;
}

export type SqlValue = string | number | boolean | Date | null | readonly string[] | object;

export interface AppStoreQueryable {
  query<Row extends object>(sql: string, params?: readonly SqlValue[]): Promise<Row[]>;
}

export interface AppStoreDatabase extends AppStoreQueryable {
  /** BEGIN … COMMIT en UNA conexión; ROLLBACK ante cualquier fallo. */
  transaction<T>(work: (tx: AppStoreQueryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

type PersistenceReason = NonNullable<PersistenceUnavailableExceptionProps['reason']>;

const POSTGRES_ERROR_REASONS: ReadonlyArray<readonly [RegExp, PersistenceReason]> = [
  [/^23/, 'INTEGRITY_VIOLATION'],
  [/^42P01$/, 'PREDICTIVE_SCHEMA_NOT_MIGRATED'],
  [/^57014$/, 'TIMEOUT'],
];

/** SQLSTATE de PostgreSQL (si existe) sin exponer SQL, valores ni stack. */
export function postgresErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

export function toAppStoreException(
  operation: string,
  error: unknown,
): PersistenceUnavailableException {
  if (error instanceof PersistenceUnavailableException) return error;
  const code = postgresErrorCode(error);
  const reason = POSTGRES_ERROR_REASONS.find(([pattern]) => code !== null && pattern.test(code));
  return new PersistenceUnavailableException({
    operation,
    reason: reason?.[1] ?? 'QUERY_FAILED',
    metadata: code ? { sqlState: code } : undefined,
    cause: error,
  });
}

function guardedQueryable(client: pg.Pool | pg.PoolClient): AppStoreQueryable {
  return {
    async query<Row extends object>(sql: string, params: readonly SqlValue[] = []) {
      assertAppStoreSql(sql);
      const result = await client.query<Row>(sql, params as unknown[]);
      return result.rows;
    },
  };
}

export class PredictiveAppDatabase implements AppStoreDatabase {
  private readonly reader: AppStoreQueryable;

  constructor(private readonly pool: pg.Pool) {
    this.reader = guardedQueryable(pool);
  }

  static connect(config: PredictiveAppDatabaseConfig): PredictiveAppDatabase {
    const statementTimeoutMs = Math.trunc(config.statementTimeoutMs);
    const pool = new pg.Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.poolMax,
      connectionTimeoutMillis: config.connectionTimeoutMs,
      idleTimeoutMillis: config.idleTimeoutMs,
      application_name: 'no-show-predictive-app-be (app-store)',
      // Sesión acotada: sentencias y esperas de bloqueo cortas (nunca bloquea la agenda).
      options: `-c statement_timeout=${statementTimeoutMs} -c lock_timeout=${statementTimeoutMs}`,
    });
    // Un cliente inactivo que cae no debe tumbar el proceso; la siguiente consulta reconecta.
    pool.on('error', () => undefined);
    return new PredictiveAppDatabase(pool);
  }

  query<Row extends object>(sql: string, params?: readonly SqlValue[]): Promise<Row[]> {
    return this.reader.query<Row>(sql, params);
  }

  async transaction<T>(work: (tx: AppStoreQueryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx = guardedQueryable(client);
    try {
      await tx.query('BEGIN');
      const result = await work(tx);
      await tx.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (!this.pool.ended) await this.pool.end();
  }
}
