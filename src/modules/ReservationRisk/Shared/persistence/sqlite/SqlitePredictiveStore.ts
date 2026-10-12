import type { DatabaseSync } from 'node:sqlite';
import {
  openSqliteDatabase,
  SqliteStoreIdentityMismatchError,
} from '../../../../../infrastructure/database/sqlite/SqliteDatabase.js';
import { PersistenceUnavailableException } from '../../../../../infrastructure/database/errors/PersistenceUnavailableException.js';
import type { DataSourceMode } from '../../../../../shared/data/DataSourceMode.js';
import {
  PREDICTIVE_STORE_MIGRATIONS,
  PREDICTIVE_STORE_SCHEMA_VERSION,
} from './PredictiveStoreSchema.js';
import { SqliteBookingSnapshotRepository } from './SqliteBookingSnapshotRepository.js';
import { SqlitePredictionResultRepository } from './SqlitePredictionResultRepository.js';
import { SqliteReservationScoreReader } from './SqliteReservationScoreReader.js';

export interface PredictiveStoreHealth {
  readonly status: 'ok' | 'error';
  readonly driver: 'sqlite';
  readonly schemaVersion: string | null;
  readonly dataSourceMode: DataSourceMode;
  readonly durable: boolean;
}

/**
 * Almacén predictivo LOCAL (SQLite, archivo bajo `.local/`, ignorado por Git). Separación total
 * respecto de PostgreSQL: aquí se escriben snapshots/runs/resultados; la fuente nunca se toca.
 * El archivo queda ligado a su modo de datos: un almacén sintético no puede abrirse en modo real.
 */
export class SqlitePredictiveStore {
  readonly snapshots: SqliteBookingSnapshotRepository;
  readonly results: SqlitePredictionResultRepository;
  readonly scores: SqliteReservationScoreReader;

  private constructor(
    private readonly db: DatabaseSync,
    private readonly mode: DataSourceMode,
    private readonly durable: boolean,
  ) {
    this.snapshots = new SqliteBookingSnapshotRepository(db);
    this.results = new SqlitePredictionResultRepository(db);
    this.scores = new SqliteReservationScoreReader(db);
  }

  static open(options: { path: string; mode: DataSourceMode }): SqlitePredictiveStore {
    try {
      const { db } = openSqliteDatabase({
        path: options.path,
        migrations: PREDICTIVE_STORE_MIGRATIONS,
        identity: { store: 'no-show-predictive-store', data_source_mode: options.mode },
      });
      return new SqlitePredictiveStore(db, options.mode, options.path !== ':memory:');
    } catch (error) {
      throw new PersistenceUnavailableException({
        operation: 'OpenPredictiveStore',
        reason:
          error instanceof SqliteStoreIdentityMismatchError
            ? 'STORE_MODE_MISMATCH'
            : 'QUERY_FAILED',
        cause: error,
      });
    }
  }

  /** Diagnóstico seguro: sin ruta, tamaños ni contenido. */
  health(): PredictiveStoreHealth {
    try {
      const version = this.db
        .prepare('SELECT max(version) AS version FROM schema_migrations')
        .get()?.version;
      const integrity = this.db.prepare('PRAGMA quick_check(1)').get()?.quick_check;
      const ok = integrity === 'ok' && version === PREDICTIVE_STORE_SCHEMA_VERSION;
      return {
        status: ok ? 'ok' : 'error',
        driver: 'sqlite',
        schemaVersion: typeof version === 'string' ? version : null,
        dataSourceMode: this.mode,
        durable: this.durable,
      };
    } catch {
      return {
        status: 'error',
        driver: 'sqlite',
        schemaVersion: null,
        dataSourceMode: this.mode,
        durable: this.durable,
      };
    }
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}
