import type { CachedMlModelCatalog } from '../../../../infrastructure/http/ml/CachedMlModelCatalog.js';
import type { RiskLevelPolicy } from '../../../ReservationRisk/Shared/policy/RiskLevelPolicy.js';
import {
  resolveResearchPolicyState,
  type ResearchPolicySettings,
} from '../../Shared/ResolveResearchPolicyState.js';
import type { ListPredictionModelsResult } from './result/ListPredictionModelsResult.js';

/** Identidad pública de los modelos servidos (sin rutas, manifiestos ni credenciales). */
export class ListPredictionModels {
  constructor(
    private readonly catalog: Pick<CachedMlModelCatalog, 'getModels'>,
    private readonly policy: Pick<RiskLevelPolicy, 'status'>,
    private readonly research: ResearchPolicySettings,
  ) {}

  async execute(input: { requestId: string }): Promise<ListPredictionModelsResult> {
    const catalog = await this.catalog.getModels({ requestId: input.requestId });
    // Campo aditivo: un fallo del catálogo v2 no oculta los modelos v1 (que siguen operando).
    const research = await resolveResearchPolicyState(this.research, {
      requestId: input.requestId,
    }).catch(() => null);

    return {
      featureVersion: catalog.feature_version,
      defaultModelKey: catalog.default_model_key,
      models: catalog.models.map((model) => ({
        modelKey: model.model_key,
        algorithm: model.algorithm,
        modelVersion: model.model_version,
        modelHash: model.model_hash,
        role: model.role,
        featureCount: model.feature_count,
        validationStatus: model.validation_status,
        calibrationStatus: model.calibration_status,
        operationalUseAllowed: false,
      })),
      riskPolicyStatus: this.policy.status,
      experimentalRiskPolicy: {
        status: research?.status ?? 'UNAVAILABLE',
        available: research?.available ?? false,
        reason: research ? research.reason : 'service_error',
        classificationBasis: research?.available ? 'RESEARCH_PROVISIONAL' : null,
        operationalUseAllowed: false,
        policies: (research?.policies ?? []).map((policy) => ({
          modelKey: policy.model_key,
          policyId: policy.policy_id,
          policyVersion: policy.policy_version,
          policyHash: policy.policy_hash,
        })),
      },
    };
  }
}
