import type { CachedMlModelCatalog } from '../../../../infrastructure/http/ml/CachedMlModelCatalog.js';
import type { RiskLevelPolicy } from '../../../ReservationRisk/Shared/policy/RiskLevelPolicy.js';
import type { ListPredictionModelsResult } from './result/ListPredictionModelsResult.js';

/** Identidad pública de los modelos servidos (sin rutas, manifiestos ni credenciales). */
export class ListPredictionModels {
  constructor(
    private readonly catalog: Pick<CachedMlModelCatalog, 'getModels'>,
    private readonly policy: Pick<RiskLevelPolicy, 'status'>,
  ) {}

  async execute(input: { requestId: string }): Promise<ListPredictionModelsResult> {
    const catalog = await this.catalog.getModels({ requestId: input.requestId });

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
    };
  }
}
