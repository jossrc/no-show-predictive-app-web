import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import pino from 'pino';
import type { Sequelize } from 'sequelize-typescript';
import { buildApp } from '../../src/app/BuildApp.js';
import {
  createPredictiveDependencies,
  openPredictiveStore,
} from '../../src/app/CreatePredictiveDependencies.js';
import { EnvironmentSchema } from '../../src/config/environment/EnvironmentSchema.js';
import { createPredictiveConfig } from '../../src/config/PredictiveConfig.js';
import type { MlPredictionClient } from '../../src/infrastructure/http/ml/MlPredictionClient.js';
import type { SqlitePredictiveStore } from '../../src/modules/ReservationRisk/Shared/persistence/sqlite/SqlitePredictiveStore.js';
import { sha256Hex } from '../../src/shared/security/VerifyInternalApiKey.js';
import { healthyCheck, TEST_INTERNAL_API_KEY } from './BuildTestApp.js';
import { FixedClock } from './FixedClock.js';

/** Cualquier acceso a PostgreSQL en modo sintético es un fallo de aislamiento. */
export const FORBIDDEN_POSTGRES = new Proxy(
  {},
  {
    get() {
      throw new Error('SYNTHETIC_DEMO_ONLY no debe usar PostgreSQL');
    },
  },
) as Sequelize;

export interface SyntheticLocalApp {
  readonly app: FastifyInstance;
  readonly store: SqlitePredictiveStore;
  readonly logLines: string[];
  close(): Promise<void>;
}

/**
 * App completa con el composition root REAL en SYNTHETIC_DEMO_ONLY: dataset sintético
 * versionado + almacén SQLite real (archivo o :memory:) + cliente ML dado (doble o Python real).
 */
export function buildSyntheticLocalApp(options: {
  readonly ml: MlPredictionClient;
  readonly sqlitePath: string;
  readonly researchEnabled?: boolean;
  readonly env?: Record<string, string>;
}): SyntheticLocalApp {
  const config = createPredictiveConfig(
    EnvironmentSchema.parse({
      ...process.env,
      DATA_SOURCE_MODE: 'SYNTHETIC_DEMO_ONLY',
      INTERNAL_API_KEY_SHA256: sha256Hex(TEST_INTERNAL_API_KEY),
      PREDICTIVE_STORE_SQLITE_PATH: options.sqlitePath,
      ML_RESEARCH_RISK_ENABLED: String(options.researchEnabled ?? true),
      ...options.env,
    }),
  );
  const store = openPredictiveStore(config);
  const logLines: string[] = [];
  const app = buildApp({
    postgresHealthCheck: healthyCheck,
    mysqlHealthCheck: null,
    loggerInstance: pino(
      { level: 'debug' },
      { write: (line: string) => void logLines.push(line) },
    ) as unknown as FastifyBaseLogger,
    mlHealth: { client: options.ml, configured: true },
    predictiveStore: store,
    predictiveApi: {
      internalApiKeySha256: sha256Hex(TEST_INTERNAL_API_KEY),
      dependencies: {
        ...createPredictiveDependencies(config, FORBIDDEN_POSTGRES, options.ml, store),
        clock: new FixedClock(new Date('2026-10-25T15:00:00.000Z')),
      },
    },
  });
  return {
    app,
    store,
    logLines,
    close: async () => {
      await app.close();
      store.close();
    },
  };
}
