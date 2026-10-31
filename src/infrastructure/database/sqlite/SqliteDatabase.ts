import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Almacén local SQLite sobre `node:sqlite` (incluido en Node >= 24, sin dependencia nativa).
 * Uso: snapshots y scores propios de la app mientras PostgreSQL es fuente de solo lectura.
 */
export const IN_MEMORY_SQLITE = ':memory:';

export interface SqliteMigration {
  readonly version: string;
  readonly name: string;
  readonly sql: string;
}

export interface OpenSqliteOptions {
  readonly path: string;
  readonly migrations: readonly SqliteMigration[];
  /** Metadatos inmutables del archivo (p. ej. modo de datos): un archivo ajeno se rechaza. */
  readonly identity: Readonly<Record<string, string>>;
  readonly busyTimeoutMs?: number;
}

export class SqliteStoreIdentityMismatchError extends Error {
  constructor(readonly key: string) {
    super(`El almacén local pertenece a otro ${key}; use otra ruta`);
    this.name = 'SqliteStoreIdentityMismatchError';
  }
}

export class SqliteMigrationChecksumError extends Error {
  constructor(readonly version: string) {
    super(`Checksum distinto para la migración local aplicada ${version}`);
    this.name = 'SqliteMigrationChecksumError';
  }
}

export function migrationChecksum(migration: SqliteMigration): string {
  return createHash('sha256').update(migration.sql, 'utf8').digest('hex');
}

/** Ejecuta `work` en una transacción corta BEGIN IMMEDIATE (bloqueo de escritura inmediato). */
export function inImmediateTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function prepareLocation(file: string): void {
  if (file === IN_MEMORY_SQLITE) return;
  const directory = path.dirname(path.resolve(file));
  // Directorio privado del usuario: el archivo puede contener edad/sexo de snapshots.
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

function restrictFiles(file: string): void {
  if (file === IN_MEMORY_SQLITE) return;
  for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
    if (existsSync(candidate)) chmodSync(candidate, 0o600);
  }
}

function applyMigrations(db: DatabaseSync, migrations: readonly SqliteMigration[]): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL CHECK (length(checksum) = 64),
    applied_at TEXT NOT NULL
  ) STRICT`);

  const applied = new Map(
    db
      .prepare('SELECT version, checksum FROM schema_migrations')
      .all()
      .map((row) => [String(row.version), String(row.checksum)]),
  );
  const appliedNow: string[] = [];

  for (const migration of migrations) {
    const checksum = migrationChecksum(migration);
    const existing = applied.get(migration.version);
    if (existing !== undefined) {
      if (existing !== checksum) throw new SqliteMigrationChecksumError(migration.version);
      continue;
    }
    inImmediateTransaction(db, () => {
      db.exec(migration.sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      ).run(migration.version, migration.name, checksum, new Date().toISOString());
    });
    appliedNow.push(migration.version);
  }
  return appliedNow;
}

function bindIdentity(db: DatabaseSync, identity: Readonly<Record<string, string>>): void {
  db.exec(`CREATE TABLE IF NOT EXISTS store_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT`);
  inImmediateTransaction(db, () => {
    for (const [key, value] of Object.entries(identity)) {
      const row = db.prepare('SELECT value FROM store_meta WHERE key = ?').get(key);
      if (row === undefined) {
        db.prepare('INSERT INTO store_meta (key, value) VALUES (?, ?)').run(key, value);
      } else if (String(row.value) !== value) {
        throw new SqliteStoreIdentityMismatchError(key);
      }
    }
  });
}

/**
 * Abre (o crea) el archivo con permisos 0700/0600, WAL, claves foráneas y busy_timeout; aplica
 * migraciones locales versionadas e idempotentes y liga el archivo a su identidad (modo de
 * datos): nunca se mezclan almacenes sintéticos y reales.
 */
export function openSqliteDatabase(options: OpenSqliteOptions): {
  db: DatabaseSync;
  appliedMigrations: string[];
} {
  prepareLocation(options.path);
  const db = new DatabaseSync(options.path, {
    timeout: Math.trunc(options.busyTimeoutMs ?? 5000),
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    defensive: true,
  });
  try {
    db.exec('PRAGMA trusted_schema = OFF');
    if (options.path !== IN_MEMORY_SQLITE) {
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = FULL');
    }
    bindIdentity(db, options.identity);
    const appliedMigrations = applyMigrations(db, options.migrations);
    restrictFiles(options.path);
    return { db, appliedMigrations };
  } catch (error) {
    db.close();
    throw error;
  }
}
