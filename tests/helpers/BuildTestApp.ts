import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import pino from 'pino';
import { buildApp } from '../../src/app/BuildApp.js';
import type { PredictiveModulesDependencies } from '../../src/app/PredictiveModulesDependencies.js';
import type { ExceptionReporter } from '../../src/app/http/errors/reporting/ExceptionReporter.js';
import type { SequelizeHealthCheck } from '../../src/infrastructure/database/sequelize/SequelizeHealthCheck.js';
import { CachedMlModelCatalog } from '../../src/infrastructure/http/ml/CachedMlModelCatalog.js';
import { CachedResearchPolicyCatalog } from '../../src/infrastructure/http/ml/CachedResearchPolicyCatalog.js';
import { PendingValidationRiskLevelPolicy } from '../../src/modules/ReservationRisk/Shared/policy/PendingValidationRiskLevelPolicy.js';
import type { RiskLevelPolicy } from '../../src/modules/ReservationRisk/Shared/policy/RiskLevelPolicy.js';
import type { DataSourceMode } from '../../src/shared/data/DataSourceMode.js';
import { sha256Hex } from '../../src/shared/security/VerifyInternalApiKey.js';
import { FakeBookingEvidenceSource } from './FakeBookingEvidenceSource.js';
import { FakePredictionClient } from './FakePredictionClient.js';
import { FixedClock } from './FixedClock.js';
import { InMemoryClientHistoryRepository } from './InMemoryClientHistoryRepository.js';
import { InMemoryPredictiveStore } from './InMemoryPredictiveStore.js';
import { InMemoryReservationRepository } from './InMemoryReservationRepository.js';

/** Credencial SOLO de pruebas (≥32 caracteres); nunca válida en otro entorno. */
export const TEST_INTERNAL_API_KEY = 'test-only-internal-key-0123456789-abcdefghijkl';
export const AUTH_HEADERS = { 'x-api-key': TEST_INTERNAL_API_KEY } as const;

export const healthyCheck = { check: async () => undefined } as unknown as SequelizeHealthCheck;

export interface TestAppContext {
  readonly app: FastifyInstance;
  readonly store: InMemoryPredictiveStore;
  readonly reservations: InMemoryReservationRepository;
  readonly history: InMemoryClientHistoryRepository;
  readonly evidence: FakeBookingEvidenceSource;
  readonly ml: FakePredictionClient;
  readonly clock: FixedClock;
  readonly logLines: string[];
}

export interface BuildTestAppOptions {
  readonly policy?: RiskLevelPolicy;
  readonly mode?: DataSourceMode;
  readonly evidence?: FakeBookingEvidenceSource;
  readonly predictiveApi?: boolean;
  /**
   * Política research v2. Por defecto deshabilitada para conservar la cobertura del camino v1
   * de las pruebas existentes; las pruebas de banda experimental la habilitan explícitamente.
   */
  readonly research?: boolean;
  readonly exceptionReporters?: readonly ExceptionReporter[];
  readonly overrides?: Partial<PredictiveModulesDependencies>;
}

/** App Fastify completa (rutas, schemas, error handler, compuerta) con dobles en memoria. */
export function buildTestApp(options: BuildTestAppOptions = {}): TestAppContext {
  const store = new InMemoryPredictiveStore();
  const reservations = new InMemoryReservationRepository(store);
  const history = new InMemoryClientHistoryRepository();
  const evidence = options.evidence ?? new FakeBookingEvidenceSource();
  const ml = new FakePredictionClient();
  const clock = new FixedClock(new Date('2026-10-25T15:00:00.000Z'));
  const logLines: string[] = [];
  const loggerInstance = pino(
    { level: 'debug' },
    { write: (line: string) => void logLines.push(line) },
  ) as unknown as FastifyBaseLogger;

  const deps: PredictiveModulesDependencies = {
    reservations,
    history,
    snapshots: store,
    results: store,
    scores: store,
    evidenceSource: evidence,
    ml,
    modelCatalog: new CachedMlModelCatalog(ml, 60_000),
    research: {
      enabled: options.research ?? false,
      catalog: new CachedResearchPolicyCatalog(ml, { ttlMs: 60_000, expectedPolicyHashes: [] }),
    },
    policy: options.policy ?? new PendingValidationRiskLevelPolicy(),
    mode: options.mode ?? 'READ_ONLY_EXISTING_SCHEDULE',
    clock,
    ...options.overrides,
  };

  const app = buildApp({
    postgresHealthCheck: healthyCheck,
    mysqlHealthCheck: null,
    loggerInstance,
    ...(options.exceptionReporters ? { exceptionReporters: options.exceptionReporters } : {}),
    mlHealth: { client: ml, configured: true },
    predictiveApi:
      options.predictiveApi === false
        ? null
        : { internalApiKeySha256: sha256Hex(TEST_INTERNAL_API_KEY), dependencies: deps },
  });

  return { app, store, reservations, history, evidence, ml, clock, logLines };
}
