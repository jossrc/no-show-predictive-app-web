/**
 * Valida ANTES de ejecutar que una migración del almacén predictivo sea estrictamente aditiva:
 * solo crea objetos nuevos `ml.app_*` (tablas, índices, función de inmutabilidad, triggers sobre
 * esas tablas) y comentarios. Rechaza vocabulario destructivo, objetos fuera del prefijo propio,
 * referencias a raw_flow/analytics, `IF [NOT] EXISTS` (oculta colisiones) y `OR REPLACE`.
 */
const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bDROP\b/i, 'DROP'],
  [/\bTRUNCATE\b(?!\s+ON\b)/i, 'TRUNCATE'],
  [/\bDELETE\s+FROM\b/i, 'DELETE'],
  [/\bUPDATE\s+(ONLY\s+)?[A-Za-z_"][\w."]*\s+SET\b/i, 'UPDATE'],
  [/\bINSERT\s+INTO\b/i, 'INSERT'],
  [/\bALTER\b/i, 'ALTER'],
  [/\bOR\s+REPLACE\b/i, 'OR REPLACE'],
  [/\bCASCADE\b/i, 'CASCADE'],
  [/\bIF\s+(NOT\s+)?EXISTS\b/i, 'IF [NOT] EXISTS'],
  [/\b(GRANT|REVOKE)\b/i, 'GRANT/REVOKE'],
  [/\bCOPY\b/i, 'COPY'],
  [/\bSET\s+(SESSION\s+)?(ROLE|AUTHORIZATION)\b/i, 'SET ROLE'],
  [/\bCREATE\s+(SCHEMA|DATABASE|ROLE|USER|EXTENSION|RULE|POLICY)\b/i, 'CREATE fuera de alcance'],
  [/\b(raw_flow|analytics|public|pg_catalog)\s*\./i, 'esquema ajeno'],
];

/** Objetos creados: deben vivir en ml.app_* (los índices/triggers apuntan a tablas ml.app_*). */
const OWN_OBJECT = /^ml\.app_[a-z0-9_]+$/;

function stripCommentsAndBodies(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, '$$body$$')
    .replace(/'(?:[^']|'')*'/g, "''");
}

export function additiveMigrationViolations(sql: string): string[] {
  const code = stripCommentsAndBodies(sql);
  const violations = FORBIDDEN.filter(([pattern]) => pattern.test(code)).map(([, name]) => name);

  for (const statement of code
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const created = /^CREATE\s+(TABLE|FUNCTION|SEQUENCE|VIEW|TYPE)\s+([\w.]+)/i.exec(statement);
    if (created && !OWN_OBJECT.test(created[2] ?? '')) {
      violations.push(`${created[1]?.toUpperCase()} fuera de ml.app_*`);
    }
    const indexed = /^CREATE\s+(UNIQUE\s+)?INDEX\s+\w+\s+ON\s+([\w.]+)/i.exec(statement);
    if (/^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(statement) && !OWN_OBJECT.test(indexed?.[2] ?? '')) {
      violations.push('INDEX fuera de ml.app_*');
    }
    const trigger = /^CREATE\s+TRIGGER\s+\w+[\s\S]*?\bON\s+([\w.]+)/i.exec(statement);
    if (/^CREATE\s+TRIGGER\b/i.test(statement) && !OWN_OBJECT.test(trigger?.[1] ?? '')) {
      violations.push('TRIGGER fuera de ml.app_*');
    }
    const comment = /^COMMENT\s+ON\s+(TABLE|COLUMN)\s+([\w.]+)/i.exec(statement);
    if (/^COMMENT\b/i.test(statement) && !/^ml\.app_/.test(comment?.[2] ?? '')) {
      violations.push('COMMENT fuera de ml.app_*');
    }
    for (const reference of statement.matchAll(/\bREFERENCES\s+([\w.]+)/gi)) {
      if (!OWN_OBJECT.test(reference[1] ?? '')) violations.push('FK hacia objeto ajeno');
    }
    if (
      !/^(CREATE\s+(TABLE|UNIQUE\s+INDEX|INDEX|FUNCTION|TRIGGER)|COMMENT\s+ON)\b/i.test(statement)
    ) {
      violations.push(`sentencia no aditiva: ${statement.slice(0, 24).replace(/\s+/g, ' ')}`);
    }
  }
  return [...new Set(violations)];
}

/** Tablas y funciones que la migración crea (para detectar colisiones antes de ejecutar). */
export function createdObjects(sql: string): { tables: string[]; functions: string[] } {
  const code = stripCommentsAndBodies(sql);
  return {
    tables: [...code.matchAll(/\bCREATE\s+TABLE\s+(ml\.app_[a-z0-9_]+)/gi)].map((m) => m[1]!),
    functions: [...code.matchAll(/\bCREATE\s+FUNCTION\s+(ml\.app_[a-z0-9_]+)/gi)].map((m) => m[1]!),
  };
}
