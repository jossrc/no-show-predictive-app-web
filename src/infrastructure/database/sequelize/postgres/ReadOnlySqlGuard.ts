import type { Sequelize } from 'sequelize-typescript';
import { InfrastructureException } from '../../../../shared/errors/infrastructure/InfrastructureException.js';

/**
 * PostgreSQL es fuente de verdad de SOLO LECTURA (raw_flow/analytics/ml). Defensa en
 * profundidad sobre la conexión runtime, además de `default_transaction_read_only=on` en la
 * sesión y de `REPEATABLE READ READ ONLY` en cada lectura:
 * - solo se admiten lecturas (SELECT/WITH sin DML, SHOW, EXPLAIN sin ANALYZE) y el control de
 *   transacción que emite Sequelize/RunInReadOnlySnapshot;
 * - cualquier otra sentencia se rechaza ANTES de llegar al servidor.
 */
export const POSTGRES_READ_ONLY_SESSION_OPTIONS = '-c default_transaction_read_only=on';

export class SourceWriteBlockedException extends InfrastructureException {
  static readonly CODE = 'SOURCE_WRITE_BLOCKED';

  constructor(statementKind: string) {
    super({
      message: 'La conexión PostgreSQL es de solo lectura',
      code: SourceWriteBlockedException.CODE,
      metadata: { statementKind },
    });
  }
}

const TRANSACTION_CONTROL = [
  /^(START\s+TRANSACTION|BEGIN)\b(\s+ISOLATION\s+LEVEL\s+[A-Z ]+?)?(\s+READ\s+ONLY)?\s*;?$/i,
  /^(COMMIT|ROLLBACK|END)\s*;?$/i,
  /^(SAVEPOINT|RELEASE\s+SAVEPOINT|ROLLBACK\s+TO\s+SAVEPOINT)\s+"?[A-Za-z0-9_-]+"?\s*;?$/i,
  /^SET\s+(SESSION\s+CHARACTERISTICS\s+AS\s+)?TRANSACTION\s+(ISOLATION\s+LEVEL\s+[A-Z ]+|READ\s+ONLY)\s*;?$/i,
  /^SET\s+LOCAL\s+(statement_timeout\s*=\s*\d+|jit\s*=\s*off)\s*;?$/i,
];

/** DML/DDL/bloqueos prohibidos en cualquier posición (CTE con DML, FOR UPDATE, SELECT INTO…). */
const MUTATION =
  /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|COPY|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COMMENT\s+ON|VACUUM|REINDEX|CLUSTER|REFRESH|CALL|LOCK|NOTIFY|LISTEN|PREPARE|EXECUTE|DO)\b|\bFOR\s+(NO\s+KEY\s+UPDATE|UPDATE|SHARE|KEY\s+SHARE)\b|\bSELECT\b[\s\S]*\bINTO\b\s+(TEMP|TEMPORARY|UNLOGGED|TABLE)?\s*[A-Za-z_"]|\b(pg_terminate_backend|pg_cancel_backend|set_config|nextval|setval|lo_import|lo_export|dblink\w*|pg_advisory\w*)\s*\(/i;

/** Literales y comentarios fuera: los nombres de columnas no cuentan como verbos SQL. */
function stripLiteralsAndComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

export function classifyReadOnlySql(sql: string): 'READ' | 'TRANSACTION_CONTROL' | 'BLOCKED' {
  const statement = sql.trim();
  if (TRANSACTION_CONTROL.some((pattern) => pattern.test(statement))) {
    return 'TRANSACTION_CONTROL';
  }

  const code = stripLiteralsAndComments(statement);
  // Una sola sentencia: `;` intermedio permitiría encadenar escrituras.
  if (/;\s*\S/.test(code)) return 'BLOCKED';
  if (!/^(SELECT|WITH|SHOW|EXPLAIN)\b/i.test(code)) return 'BLOCKED';
  if (/^EXPLAIN\b[^;]*\bANALY[SZ]E\b/i.test(code)) return 'BLOCKED';
  return MUTATION.test(code) ? 'BLOCKED' : 'READ';
}

export function assertReadOnlySql(sql: string): void {
  if (classifyReadOnlySql(sql) === 'BLOCKED') {
    const kind = /^\s*([A-Za-z]+)/.exec(sql)?.[1]?.toUpperCase() ?? 'UNKNOWN';
    throw new SourceWriteBlockedException(kind);
  }
}

/**
 * Envuelve `sequelize.query`, punto por el que pasan consultas, `authenticate()` y el control de
 * transacciones. (El hook `beforeQuery` no sirve: se ejecuta antes de asignar el SQL al Query.)
 */
export function installReadOnlySqlGuard(sequelize: Sequelize): Sequelize {
  const original = sequelize.query.bind(sequelize);
  const guarded = (sql: unknown, options?: unknown): Promise<unknown> => {
    const text = typeof sql === 'string' ? sql : (sql as { query?: unknown } | null)?.query;
    try {
      assertReadOnlySql(typeof text === 'string' ? text : '');
    } catch (error) {
      return Promise.reject(error);
    }
    return (original as (sql: unknown, options?: unknown) => Promise<unknown>)(sql, options);
  };
  Object.defineProperty(sequelize, 'query', { value: guarded, writable: false });
  return sequelize;
}
