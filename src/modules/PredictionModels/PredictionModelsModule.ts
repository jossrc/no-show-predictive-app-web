import type { FastifyPluginAsync } from 'fastify';
import type { CachedMlModelCatalog } from '../../infrastructure/http/ml/CachedMlModelCatalog.js';
import type { RiskLevelPolicy } from '../ReservationRisk/Shared/policy/RiskLevelPolicy.js';
import { ListPredictionModels } from './ListPredictionModels/application/ListPredictionModels.js';
import { ListPredictionModelsHandler } from './ListPredictionModels/presentation/http/handler/ListPredictionModelsHandler.js';
import { registerListPredictionModelsRoute } from './ListPredictionModels/presentation/http/route/ListPredictionModelsRoute.js';

export interface PredictionModelsModuleOptions {
  modelCatalog: Pick<CachedMlModelCatalog, 'getModels'>;
  policy: Pick<RiskLevelPolicy, 'status'>;
}

export function createPredictionModelsModule(
  options: PredictionModelsModuleOptions,
): FastifyPluginAsync {
  return async (app): Promise<void> => {
    const listPredictionModels = new ListPredictionModels(options.modelCatalog, options.policy);
    registerListPredictionModelsRoute(app, {
      handler: new ListPredictionModelsHandler(listPredictionModels),
    });
  };
}
