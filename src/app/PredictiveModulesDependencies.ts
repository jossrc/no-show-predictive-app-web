import type { CachedMlModelCatalog } from '../infrastructure/http/ml/CachedMlModelCatalog.js';
import type { CachedResearchPolicyCatalog } from '../infrastructure/http/ml/CachedResearchPolicyCatalog.js';
import type { MlPredictionClient } from '../infrastructure/http/ml/MlPredictionClient.js';
import type { ClientHistoryRepository } from '../modules/ClientHistory/Shared/persistence/ClientHistoryRepository.js';
import type { BookingEvidenceSource } from '../modules/ReservationRisk/Shared/persistence/BookingEvidenceSource.js';
import type { BookingSnapshotRepository } from '../modules/ReservationRisk/Shared/persistence/BookingSnapshotRepository.js';
import type { PredictionResultRepository } from '../modules/ReservationRisk/Shared/persistence/PredictionResultRepository.js';
import type { RiskLevelPolicy } from '../modules/ReservationRisk/Shared/policy/RiskLevelPolicy.js';
import type { PredictiveStoreHealth } from '../modules/ReservationRisk/Shared/persistence/sqlite/SqlitePredictiveStore.js';
import type { ReservationRepository } from '../modules/Reservations/Shared/persistence/ReservationRepository.js';
import type { ReservationScoreReader } from '../modules/Reservations/Shared/persistence/ReservationScoreReader.js';
import type { DataSourceMode } from '../shared/data/DataSourceMode.js';
import type { Clock } from '../shared/time/Clock.js';

/** Dependencias inyectables de los módulos de negocio del Sprint 01 (reales o de prueba). */
export interface PredictiveModulesDependencies {
  readonly reservations: ReservationRepository;
  readonly history: ClientHistoryRepository;
  readonly snapshots: BookingSnapshotRepository;
  readonly results: PredictionResultRepository;
  /** Lectura de scores del almacén local para listado/detalle. */
  readonly scores: ReservationScoreReader;
  readonly evidenceSource: BookingEvidenceSource;
  readonly ml: MlPredictionClient;
  readonly modelCatalog: CachedMlModelCatalog;
  /** Política research v2 (bandas experimentales); `enabled` = ML_RESEARCH_RISK_ENABLED. */
  readonly research: { readonly enabled: boolean; readonly catalog: CachedResearchPolicyCatalog };
  /** Política OPERATIVA aprobada (hoy PendingValidationRiskLevelPolicy). */
  readonly policy: RiskLevelPolicy;
  readonly mode: DataSourceMode;
  readonly clock: Clock;
}

export interface PredictiveApiRegistration {
  /** SHA-256 de la credencial interna provisional (no es login HU-21). */
  readonly internalApiKeySha256: string;
  readonly dependencies: PredictiveModulesDependencies;
}

export interface PredictiveStoreHealthRegistration {
  health(): PredictiveStoreHealth;
}

export interface MlHealthRegistration {
  readonly client: Pick<MlPredictionClient, 'ready'>;
  readonly configured: boolean;
}
