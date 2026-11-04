import { InfrastructureException } from '../../../shared/errors/infrastructure/InfrastructureException.js';

/**
 * Defensa en profundidad de la conexión ESCRITORA de la app (además de los privilegios mínimos
 * del rol runtime y de los triggers de inmutabilidad): solo lecturas e INSERT sobre las tablas
 * propias `ml.app_*`, más el control de transacción. Nunca UPDATE/DELETE/DDL ni acceso a
 * raw_flow/analytics: esa fuente se lee exclusivamente por la conexión de solo lectura.
 */
export class AppStoreStatementBlockedException extends InfrastructureException {
  static readonly CODE = 'APP_STORE_STATEMENT_BLOCKED';

  constructor(statementKind: string) {
    super({
      message: 'Sentencia no permitida en el almacén predictivo',
      code: AppStoreStatementBlockedException.CODE,
      metadata: { statementKind },
    });
  }
}

const TRANSACTION_CONTROL = [
  /^(BEGIN|START\s+TRANSACTION)(\s+ISOLATION\s+LEVEL\s+(READ\s+COMMITTED|REPEATABLE\s+READ|SERIALIZABLE))?(\s+READ\s+ONLY)?\s*;?$/i,
  /^(COMMIT|ROLLBACK)\s*;?$/i,
  /^SET\s+LOCAL\s+(statement_timeout|lock_timeout)\s*=\s*\d+\s*;?$/i,
];

/** Verbos y construcciones prohibidos en cualquier posición (CTE, subconsulta, upsert…). */
const FORBIDDEN =
  /\b(UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|VACUUM|REINDEX|CLUSTER|REFRESH|CALL|LOCK|COMMENT|EXECUTE|PREPARE)\b|\bON\s+CONFLICT\b[^;]*\bDO\s+UPDATE\b|\b(raw_flow|analytics|public|pg_catalog)\s*\.|\b(set_config|pg_terminate_backend|pg_cancel_backend|dblink\w*|lo_import|lo_export|pg_read_file|pg_advisory\w*)\s*\(/i;

function stripLiteralsAndComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

export type AppStoreStatementKind = 'READ' | 'INSERT' | 'TRANSACTION_CONTROL' | 'BLOCKED';

export function classifyAppStoreSql(sql: string): AppStoreStatementKind {
  const statement = sql.trim();
  if (TRANSACTION_CONTROL.some((pattern) => pattern.test(statement))) return 'TRANSACTION_CONTROL';

  const code = stripLiteralsAndComments(statement);
  // Una sola sentencia y solo SELECT/WITH/INSERT (sin DO, $$ ni encadenados).
  if (
    /;\s*\S/.test(code) ||
    /\$[A-Za-z_]*\$/.test(code) ||
    !/^(SELECT|WITH|INSERT)\b/i.test(code)
  ) {
    return 'BLOCKED';
  }
  if (FORBIDDEN.test(code)) return 'BLOCKED';
  // Bloqueos de filas: solo se escribe por INSERT idempotente, nunca se bloquean filas.
  if (/\bFOR\s+(NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b/i.test(code)) return 'BLOCKED';

  const inserts = [...code.matchAll(/\bINSERT\s+INTO\s+([A-Za-z_][\w.]*)/gi)].map((m) => m[1]);
  if (inserts.some((target) => !/^ml\.app_[a-z0-9_]+$/.test(target ?? ''))) return 'BLOCKED';
  return inserts.length > 0 ? 'INSERT' : 'READ';
}

export function assertAppStoreSql(sql: string): void {
  if (classifyAppStoreSql(sql) === 'BLOCKED') {
    const kind = /^\s*([A-Za-z]+)/.exec(sql)?.[1]?.toUpperCase() ?? 'UNKNOWN';
    throw new AppStoreStatementBlockedException(kind);
  }
}
