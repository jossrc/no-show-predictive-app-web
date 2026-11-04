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
import { PostgresAttendanceOutcomeRepository } from '../modules/OperationalOptimization/Shared/persistence/postgres/PostgresAttendanceOutcomeRepository.js';
import { PostgresOperationalStatusReader } from '../modules/OperationalOptimization/Shared/persistence/postgres/PostgresOperationalStatusReader.js';
import { PostgresOverbookingAuthorizationRepository } from '../modules/OperationalOptimization/Shared/persistence/postgres/PostgresOverbookingAuthorizationRepository.js';
import { PostgresSpaceRecoveryOutcomeRepository } from '../modules/OperationalOptimization/Shared/persistence/postgres/PostgresSpaceRecoveryOutcomeRepository.js';
import { PostgresPredictiveStore } from '../modules/ReservationRisk/Shared/persistence/postgres/PostgresPredictiveStore.js';
import { SequelizeBookingEvidenceSource } from '../modules/ReservationRisk/Shared/persistence/sequelize/SequelizeBookingEvidenceSource.js';
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

/**
 * Almacén predictivo PostgreSQL de la app (ADR-008): conexión propia con rol restringido,
 * verificada al abrir (base, rol, versión de esquema, modo). Sin credenciales ⇒ error de arranque;
 * nunca vuelve a SQLite ni a memoria.
 */
export async function openPredictiveStore(
  config: PredictiveConfig,
): Promise<PostgresPredictiveStore> {
  if (!config.store.database) {
    throw new Error('Almacén predictivo PostgreSQL sin configurar (APP_DB_*_POSTGRES)');
  }
  return PostgresPredictiveStore.open(config.store.database, {
    mode: config.dataSourceMode,
    allowPrivilegedRole: config.store.allowPrivilegedRole,
  });
}

/**
 * Composition root de infraestructura real (ADR-008, sustituye el almacén SQLite de ADR-006):
 * - READ_ONLY_EXISTING_SCHEDULE: reservas, evidencia e historial desde PostgreSQL en SOLO
 *   LECTURA (conexión fuente con guard); snapshots/runs/scores y registros HU-06/07/08 en
 *   ml.app_* por la conexión PROPIA de la app (SELECT/INSERT).
 * - SYNTHETIC_DEMO_ONLY: reservas, evidencia e historial del dataset sintético versionado
 *   (ninguna lectura de negocio a la fuente) y su propio almacén PostgreSQL ligado a ese modo.
 */
export function createPredictiveDependencies(
  config: PredictiveConfig,
  sequelize: Sequelize,
  ml: MlPredictionClient,
  store: PostgresPredictiveStore,
): PredictiveModulesDependencies {
  const timeoutMs = config.sourceStatementTimeoutMs;
  const synthetic = config.dataSourceMode === 'SYNTHETIC_DEMO_ONLY';
  const source = synthetic
    ? new SyntheticReservationSource()
    : new SequelizeReservationRepository(sequelize, timeoutMs);

  const statuses = new PostgresOperationalStatusReader(store.database);

  return {
    reservations: new ScoredReservationRepository(source, store.scores, statuses),
    history: synthetic
      ? new SyntheticClientHistoryRepository()
      : new SequelizeClientHistoryRepository(sequelize, timeoutMs),
    snapshots: store.snapshots,
    results: store.results,
    scores: store.scores,
    runs: store.results,
    operations: {
      authorizations: new PostgresOverbookingAuthorizationRepository(store.database),
      attendance: new PostgresAttendanceOutcomeRepository(store.database),
      recoveries: new PostgresSpaceRecoveryOutcomeRepository(store.database),
    },
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
