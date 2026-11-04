import {
  PersistenceUnavailableException,
  type PersistenceUnavailableExceptionProps,
} from '../../../../../infrastructure/database/errors/PersistenceUnavailableException.js';
import {
  PredictiveAppDatabase,
  toAppStoreException,
  type AppStoreDatabase,
  type PredictiveAppDatabaseConfig,
} from '../../../../../infrastructure/database/postgres/PredictiveAppDatabase.js';
import { PREDICTIVE_APP_SCHEMA_VERSION } from '../../../../../infrastructure/database/postgres/PredictiveAppMigrationRunner.js';
import type { DataSourceMode } from '../../../../../shared/data/DataSourceMode.js';
import { PostgresBookingSnapshotRepository } from './PostgresBookingSnapshotRepository.js';
import { PostgresPredictionResultRepository } from './PostgresPredictionResultRepository.js';
import { PostgresReservationScoreReader } from './PostgresReservationScoreReader.js';

export interface PredictiveStoreHealth {
  readonly status: 'ok' | 'error';
  readonly driver: 'postgresql';
  readonly schemaVersion: string | null;
  readonly dataSourceMode: DataSourceMode;
  readonly durable: boolean;
  /** El rol runtime no es superusuario ni puede crear objetos en el schema ml. */
  readonly restrictedRole: boolean | null;
}

export interface OpenPostgresPredictiveStoreOptions {
  readonly mode: DataSourceMode;
  /** Solo desarrollo local sin roles aprovisionados; jamás en production (lo valida la config). */
  readonly allowPrivilegedRole: boolean;
}

interface StoreFacts {
  readonly database: string;
  readonly privileged: boolean;
  readonly schemaVersion: string | null;
  readonly boundMode: string | null;
}

const FACTS_SQL = `
SELECT current_database() AS database,
       (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
         OR has_schema_privilege(current_user, 'ml', 'CREATE') AS privileged,
       to_regclass('ml.app_predictive_store_migrations') IS NOT NULL AS has_history,
       to_regclass('ml.app_predictive_store_identity') IS NOT NULL AS has_identity`;

/**
 * Almacén predictivo PostgreSQL (ml.app_*): snapshots, runs y scores research v2 de Sprint 01 y
 * base de los registros de Sprint 02. Al abrir verifica base, rol restringido, versión de esquema
 * e identidad de modo; ante cualquier discrepancia falla cerrado (PERSISTENCE_UNAVAILABLE): nunca
 * vuelve a SQLite ni a memoria.
 */
export class PostgresPredictiveStore {
  readonly snapshots: PostgresBookingSnapshotRepository;
  readonly results: PostgresPredictionResultRepository;
  readonly scores: PostgresReservationScoreReader;

  private constructor(
    readonly database: AppStoreDatabase,
    private readonly mode: DataSourceMode,
  ) {
    this.snapshots = new PostgresBookingSnapshotRepository(database);
    this.results = new PostgresPredictionResultRepository(database);
    this.scores = new PostgresReservationScoreReader(database);
  }

  static async open(
    config: PredictiveAppDatabaseConfig,
    options: OpenPostgresPredictiveStoreOptions,
  ): Promise<PostgresPredictiveStore> {
    const database = PredictiveAppDatabase.connect(config);
    try {
      return await PostgresPredictiveStore.verify(database, config.database, options);
    } catch (error) {
      await database.close();
      throw error;
    }
  }

  /** Verificación de arranque sobre una conexión ya creada (también usada por las pruebas). */
  static async verify(
    database: AppStoreDatabase,
    expectedDatabase: string,
    options: OpenPostgresPredictiveStoreOptions,
  ): Promise<PostgresPredictiveStore> {
    const facts = await readFacts(database);
    const fail = (reason: NonNullable<PersistenceUnavailableExceptionProps['reason']>) =>
      new PersistenceUnavailableException({ operation: 'OpenPredictiveStore', reason });

    if (facts.database !== expectedDatabase) throw fail('DATABASE_MISMATCH');
    if (facts.privileged && !options.allowPrivilegedRole) throw fail('PRIVILEGED_ROLE_REJECTED');
    if (facts.schemaVersion !== PREDICTIVE_APP_SCHEMA_VERSION)
      throw fail('SCHEMA_VERSION_MISMATCH');
    if (facts.boundMode === null) throw fail('STORE_NOT_BOUND');
    if (facts.boundMode !== options.mode) throw fail('STORE_MODE_MISMATCH');
    return new PostgresPredictiveStore(database, options.mode);
  }

  /** Diagnóstico seguro: sin credenciales, host, nombres de base ni datos. */
  async health(): Promise<PredictiveStoreHealth> {
    try {
      const facts = await readFacts(this.database);
      const ok =
        facts.schemaVersion === PREDICTIVE_APP_SCHEMA_VERSION && facts.boundMode === this.mode;
      return {
        status: ok ? 'ok' : 'error',
        driver: 'postgresql',
        schemaVersion: facts.schemaVersion,
        dataSourceMode: this.mode,
        durable: true,
        restrictedRole: !facts.privileged,
      };
    } catch {
      return {
        status: 'error',
        driver: 'postgresql',
        schemaVersion: null,
        dataSourceMode: this.mode,
        durable: true,
        restrictedRole: null,
      };
    }
  }

  close(): Promise<void> {
    return this.database.close();
  }
}

async function readFacts(database: AppStoreDatabase): Promise<StoreFacts> {
  try {
    const [facts] = await database.query<{
      database: string;
      privileged: boolean;
      has_history: boolean;
      has_identity: boolean;
    }>(FACTS_SQL);
    if (!facts) throw new Error('Sin respuesta de PostgreSQL');
    const [version] = facts.has_history
      ? await database.query<{ version: string | null }>(
          'SELECT max(version) AS version FROM ml.app_predictive_store_migrations',
        )
      : [];
    const [identity] = facts.has_identity
      ? await database.query<{ data_source_mode: string }>(
          'SELECT data_source_mode FROM ml.app_predictive_store_identity',
        )
      : [];
    return {
      database: facts.database,
      privileged: facts.privileged === true,
      schemaVersion: version?.version ?? null,
      boundMode: identity?.data_source_mode ?? null,
    };
  } catch (error) {
    throw toAppStoreException('ReadPredictiveStoreFacts', error);
  }
}
