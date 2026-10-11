import type { Sequelize } from 'sequelize-typescript';
import type { PredictiveConfig } from '../config/PredictiveConfig.js';
import { PredictiveStoreProbe } from '../infrastructure/database/sequelize/postgres/PredictiveStoreProbe.js';
import { CachedMlModelCatalog } from '../infrastructure/http/ml/CachedMlModelCatalog.js';
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
import { SequelizeBookingEvidenceSource } from '../modules/ReservationRisk/Shared/persistence/sequelize/SequelizeBookingEvidenceSource.js';
import { SequelizeBookingSnapshotRepository } from '../modules/ReservationRisk/Shared/persistence/sequelize/SequelizeBookingSnapshotRepository.js';
import { SequelizePredictionResultRepository } from '../modules/ReservationRisk/Shared/persistence/sequelize/SequelizePredictionResultRepository.js';
import { PendingValidationRiskLevelPolicy } from '../modules/ReservationRisk/Shared/policy/PendingValidationRiskLevelPolicy.js';
import { SequelizeReservationRepository } from '../modules/Reservations/Shared/persistence/sequelize/SequelizeReservationRepository.js';
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

/** Composition root de infraestructura real: PostgreSQL (Sequelize) + cliente HTTP ML. */
export function createPredictiveDependencies(
  config: PredictiveConfig,
  sequelize: Sequelize,
  ml: MlPredictionClient,
): PredictiveModulesDependencies {
  const timeoutMs = config.sourceStatementTimeoutMs;

  return {
    reservations: new SequelizeReservationRepository(
      sequelize,
      new PredictiveStoreProbe(sequelize),
      timeoutMs,
    ),
    history: new SequelizeClientHistoryRepository(sequelize, timeoutMs),
    snapshots: new SequelizeBookingSnapshotRepository(sequelize),
    results: new SequelizePredictionResultRepository(sequelize),
    evidenceSource: new SequelizeBookingEvidenceSource(sequelize, timeoutMs),
    ml,
    modelCatalog: new CachedMlModelCatalog(ml, config.ml.modelCatalogTtlMs),
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
