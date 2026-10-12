import type { FastifyPluginAsync } from 'fastify';
import type { CachedMlModelCatalog } from '../../infrastructure/http/ml/CachedMlModelCatalog.js';
import type { RiskLevelPolicy } from '../ReservationRisk/Shared/policy/RiskLevelPolicy.js';
import { GetResearchRiskPolicy } from './GetResearchRiskPolicy/application/GetResearchRiskPolicy.js';
import { GetResearchRiskPolicyHandler } from './GetResearchRiskPolicy/presentation/http/handler/GetResearchRiskPolicyHandler.js';
import { registerGetResearchRiskPolicyRoute } from './GetResearchRiskPolicy/presentation/http/route/GetResearchRiskPolicyRoute.js';
import { ListPredictionModels } from './ListPredictionModels/application/ListPredictionModels.js';
import { ListPredictionModelsHandler } from './ListPredictionModels/presentation/http/handler/ListPredictionModelsHandler.js';
import { registerListPredictionModelsRoute } from './ListPredictionModels/presentation/http/route/ListPredictionModelsRoute.js';
import type { ResearchPolicySettings } from './Shared/ResolveResearchPolicyState.js';

export interface PredictionModelsModuleOptions {
  modelCatalog: Pick<CachedMlModelCatalog, 'getModels'>;
  policy: Pick<RiskLevelPolicy, 'status'>;
  research: ResearchPolicySettings;
}

export function createPredictionModelsModule(
  options: PredictionModelsModuleOptions,
): FastifyPluginAsync {
  return async (app): Promise<void> => {
    const listPredictionModels = new ListPredictionModels(
      options.modelCatalog,
      options.policy,
      options.research,
    );
    registerListPredictionModelsRoute(app, {
      handler: new ListPredictionModelsHandler(listPredictionModels),
    });
    registerGetResearchRiskPolicyRoute(app, {
      handler: new GetResearchRiskPolicyHandler(
        new GetResearchRiskPolicy(options.research, options.policy),
      ),
    });
  };
}
