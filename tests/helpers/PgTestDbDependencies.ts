import type { Sequelize } from 'sequelize-typescript';
import { createPredictiveDependencies } from '../../src/app/CreatePredictiveDependencies.js';
import type { PredictiveModulesDependencies } from '../../src/app/PredictiveModulesDependencies.js';
import type { PredictiveConfig } from '../../src/config/PredictiveConfig.js';
import type { MlPredictionClient } from '../../src/infrastructure/http/ml/MlPredictionClient.js';
import { SequelizeClientHistoryRepository } from '../../src/modules/ClientHistory/Shared/persistence/sequelize/SequelizeClientHistoryRepository.js';
import { SequelizeBookingEvidenceSource } from '../../src/modules/ReservationRisk/Shared/persistence/sequelize/SequelizeBookingEvidenceSource.js';
import type { SqlitePredictiveStore } from '../../src/modules/ReservationRisk/Shared/persistence/sqlite/SqlitePredictiveStore.js';
import { ScoredReservationRepository } from '../../src/modules/Reservations/Shared/persistence/ScoredReservationRepository.js';
import { SequelizeReservationRepository } from '../../src/modules/Reservations/Shared/persistence/sequelize/SequelizeReservationRepository.js';

/**
 * Dependencias para las pruebas sobre la BD PostgreSQL de PRUEBA (depi_noshow_test): la réplica
 * sintética de esa base actúa como fuente (también en SYNTHETIC_DEMO_ONLY, en lugar del dataset
 * versionado) y la persistencia va al almacén SQLite indicado, como en runtime.
 */
export function pgTestDbDependencies(
  config: PredictiveConfig,
  sequelize: Sequelize,
  ml: MlPredictionClient,
  store: SqlitePredictiveStore,
): PredictiveModulesDependencies {
  const base = createPredictiveDependencies(config, sequelize, ml, store);
  if (config.dataSourceMode !== 'SYNTHETIC_DEMO_ONLY') return base;
  return {
    ...base,
    reservations: new ScoredReservationRepository(
      new SequelizeReservationRepository(sequelize, 5000),
      store.scores,
    ),
    history: new SequelizeClientHistoryRepository(sequelize, 5000),
    evidenceSource: new SequelizeBookingEvidenceSource(sequelize, 5000),
  };
}
