import type { Sequelize } from 'sequelize-typescript';
import type { PredictiveConfig } from '../config/PredictiveConfig.js';
import { CachedMlModelCatalog } from '../infrastructure/http/ml/CachedMlModelCatalog.js';
import { CachedResearchPolicyCatalog } from '../infrastructure/http/ml/CachedResearchPolicyCatalog.js';
import {
  HttpMlPredictionClient,
  type MlClientLogger,
} from '../infrastructure/http/ml/HttpMlPredictionClient.js';
import type { MlPredictionClient } from '../infrastructure/http/ml/MlPredictionClient.js';
import { MlTimeoutPolicy } from '../infrastructure/http/ml/MlTimeoutPolicy.js';
import { UnconfiguredMlPredictionClient } from '../infrastructure/http/ml/UnconfiguredMlPredictionClient.js';
import { CircuitBreaker } from '../infrastructure/resilience/CircuitBreaker.js';
import { ConcurrencyLimiter } from '../infrastructure/resilience/ConcurrencyLimiter.js';
import { SequelizeClientHistoryRepository } from '../modules/ClientHistory/Shared/persistence/sequelize/SequelizeClientHistoryRepository.js';
import { SyntheticClientHistoryRepository } from '../modules/ClientHistory/Shared/persistence/synthetic/SyntheticClientHistoryRepository.js';
import { SequelizeBookingEvidenceSource } from '../modules/ReservationRisk/Shared/persistence/sequelize/SequelizeBookingEvidenceSource.js';
import { SqlitePredictiveStore } from '../modules/ReservationRisk/Shared/persistence/sqlite/SqlitePredictiveStore.js';
import { SyntheticBookingEvidenceSource } from '../modules/ReservationRisk/Shared/persistence/synthetic/SyntheticBookingEvidenceSource.js';
import { PendingValidationRiskLevelPolicy } from '../modules/ReservationRisk/Shared/policy/PendingValidationRiskLevelPolicy.js';
import { ScoredReservationRepository } from '../modules/Reservations/Shared/persistence/ScoredReservationRepository.js';
import { SequelizeReservationRepository } from '../modules/Reservations/Shared/persistence/sequelize/SequelizeReservationRepository.js';
import { SyntheticReservationSource } from '../modules/Reservations/Shared/persistence/synthetic/SyntheticReservationSource.js';
import { systemClock } from '../shared/time/Clock.js';
import type {
  MlHealthRegistration,
  PredictiveModulesDependencies,
} from './PredictiveModulesDependencies.js';

export function createMlPredictionClient(
  config: PredictiveConfig['ml'],
  logger: MlClientLogger,
): MlPredictionClient {
  if (!config.serviceKey) return new UnconfiguredMlPredictionClient();

  return new HttpMlPredictionClient({
    baseUrl: config.baseUrl,
    serviceKey: config.serviceKey,
    timeoutPolicy: new MlTimeoutPolicy({
      defaultMs: config.defaultTimeoutMs,
      explanationMs: config.explanationTimeoutMs,
    }),
    inferenceLimiter: new ConcurrencyLimiter(
      config.maxConcurrentRequests,
      config.maxQueuedRequests,
    ),
    explanationLimiter: new ConcurrencyLimiter(
      config.maxConcurrentExplanations,
      config.maxQueuedRequests,
    ),
    circuitBreaker: new CircuitBreaker({
      failureThreshold: config.circuitFailureThreshold,
      cooldownMs: config.circuitCooldownMs,
    }),
    batchMaxItems: config.batchMaxItems,
    logger,
  });
}

/** Almacén predictivo LOCAL (SQLite) del modo activo: único destino de escrituras de la app. */
export function openPredictiveStore(config: PredictiveConfig): SqlitePredictiveStore {
  return SqlitePredictiveStore.open({ path: config.store.sqlitePath, mode: config.dataSourceMode });
}

/**
 * Composition root de infraestructura real (ADR-006):
 * - READ_ONLY_EXISTING_SCHEDULE: reservas, evidencia e historial desde PostgreSQL en SOLO
 *   LECTURA (conexión con guard); snapshots/runs/scores en el SQLite local.
 * - SYNTHETIC_DEMO_ONLY: reservas, evidencia e historial del dataset sintético versionado
 *   (ninguna lectura de negocio a PostgreSQL) y su propio archivo SQLite.
 * El adaptador PostgreSQL del schema `ml` se conserva aislado y NO se conecta aquí.
 */
export function createPredictiveDependencies(
  config: PredictiveConfig,
  sequelize: Sequelize,
  ml: MlPredictionClient,
  store: SqlitePredictiveStore,
): PredictiveModulesDependencies {
  const timeoutMs = config.sourceStatementTimeoutMs;
  const synthetic = config.dataSourceMode === 'SYNTHETIC_DEMO_ONLY';
  const source = synthetic
    ? new SyntheticReservationSource()
    : new SequelizeReservationRepository(sequelize, timeoutMs);

  return {
    reservations: new ScoredReservationRepository(source, store.scores),
    history: synthetic
      ? new SyntheticClientHistoryRepository()
      : new SequelizeClientHistoryRepository(sequelize, timeoutMs),
    snapshots: store.snapshots,
    results: store.results,
    scores: store.scores,
    evidenceSource: synthetic
      ? new SyntheticBookingEvidenceSource()
      : new SequelizeBookingEvidenceSource(sequelize, timeoutMs),
    ml,
    modelCatalog: new CachedMlModelCatalog(ml, config.ml.modelCatalogTtlMs),
    research: {
      enabled: config.ml.researchRiskEnabled,
      catalog: new CachedResearchPolicyCatalog(ml, {
        ttlMs: config.ml.modelCatalogTtlMs,
        expectedPolicyHashes: config.ml.expectedResearchPolicyHashes,
      }),
    },
    policy: new PendingValidationRiskLevelPolicy(),
    mode: config.dataSourceMode,
    clock: systemClock,
  };
}

export function createMlHealthRegistration(
  config: PredictiveConfig['ml'],
  ml: MlPredictionClient,
): MlHealthRegistration {
  return { client: ml, configured: config.serviceKey !== null };
}
