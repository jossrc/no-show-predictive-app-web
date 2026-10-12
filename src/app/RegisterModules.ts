import type { FastifyInstance } from 'fastify';
import type { SequelizeHealthCheck } from '../infrastructure/database/sequelize/SequelizeHealthCheck.js';
import { createClientHistoryModule } from '../modules/ClientHistory/ClientHistoryModule.js';
import { createHealthModule } from '../modules/Health/HealthModule.js';
import { createPredictionModelsModule } from '../modules/PredictionModels/PredictionModelsModule.js';
import { createReservationRiskModule } from '../modules/ReservationRisk/ReservationRiskModule.js';
import { createReservationsModule } from '../modules/Reservations/ReservationsModule.js';
import { registerInternalApiKeyGuard } from './http/security/InternalApiKeyGuard.js';
import type {
  MlHealthRegistration,
  PredictiveApiRegistration,
  PredictiveStoreHealthRegistration,
} from './PredictiveModulesDependencies.js';

export interface RegisterModulesOptions {
  postgresHealthCheck: SequelizeHealthCheck;
  mysqlHealthCheck: SequelizeHealthCheck | null;
  mlHealth?: MlHealthRegistration | undefined;
  predictiveStore?: PredictiveStoreHealthRegistration | null | undefined;
  /** null/undefined: rutas de negocio no registradas (sin credencial o deshabilitadas). */
  predictiveApi?: PredictiveApiRegistration | null | undefined;
}

export function registerModules(app: FastifyInstance, options: RegisterModulesOptions): void {
  app.register(
    async (api) => {
      await api.register(
        createHealthModule({
          postgresHealthCheck: options.postgresHealthCheck,
          mysqlHealthCheck: options.mysqlHealthCheck,
          mlHealth: options.mlHealth,
          predictiveStore: options.predictiveStore,
        }),
      );

      const predictiveApi = options.predictiveApi;
      if (!predictiveApi) return;

      // Contexto encapsulado: la compuerta provisional aplica SOLO a rutas de negocio /api/v1.
      await api.register(
        async (secured) => {
          registerInternalApiKeyGuard(secured, predictiveApi.internalApiKeySha256);
          const deps = predictiveApi.dependencies;

          await secured.register(
            createReservationsModule({
              reservations: deps.reservations,
              clock: deps.clock,
              mode: deps.mode,
            }),
          );
          await secured.register(createReservationRiskModule(deps));
          await secured.register(
            createClientHistoryModule({
              reservations: deps.reservations,
              history: deps.history,
              clock: deps.clock,
            }),
          );
          await secured.register(
            createPredictionModelsModule({
              modelCatalog: deps.modelCatalog,
              policy: deps.policy,
              research: deps.research,
            }),
          );
        },
        { prefix: '/v1' },
      );
    },
    {
      prefix: '/api',
    },
  );
}
