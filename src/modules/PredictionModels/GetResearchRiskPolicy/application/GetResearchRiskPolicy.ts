import { EXPERIMENTAL_RISK_LABELS } from '../../../../infrastructure/http/ml/MlResearchContractSchemas.js';
import { EXPERIMENTAL_RISK_NOTICE } from '../../../ReservationRisk/Shared/http/RiskAssessmentHttpMapper.js';
import type { RiskLevelPolicy } from '../../../ReservationRisk/Shared/policy/RiskLevelPolicy.js';
import {
  resolveResearchPolicyState,
  type ResearchPolicySettings,
} from '../../Shared/ResolveResearchPolicyState.js';
import type { GetResearchRiskPolicyResult } from './result/GetResearchRiskPolicyResult.js';

/**
 * Política research v2 publicada por Python para la UI: identidad, límites y advertencias. No
 * revela configuración privada, claves ni payloads. Disponibilidad experimental ≠ aprobación.
 */
export class GetResearchRiskPolicy {
  constructor(
    private readonly research: ResearchPolicySettings,
    private readonly approvedPolicy: Pick<RiskLevelPolicy, 'status'>,
  ) {}

  async execute(input: { requestId: string }): Promise<GetResearchRiskPolicyResult> {
    const state = await resolveResearchPolicyState(this.research, { requestId: input.requestId });
    return {
      nodeResearchRiskEnabled: state.nodeResearchRiskEnabled,
      available: state.available,
      status: state.status,
      reason: state.reason,
      classificationBasis: state.available ? 'RESEARCH_PROVISIONAL' : null,
      approvedRiskPolicyStatus: this.approvedPolicy.status,
      validationStatus: 'EXPLORATORY_NOT_VALIDATED',
      operationalUseAllowed: false,
      labels: { ...EXPERIMENTAL_RISK_LABELS },
      notice: EXPERIMENTAL_RISK_NOTICE,
      policies: state.policies.map((policy) => ({
        modelKey: policy.model_key,
        modelVersion: policy.model_version,
        modelHashSha256: policy.model_hash_sha256,
        policyId: policy.policy_id,
        policyVersion: policy.policy_version,
        policyHash: policy.policy_hash,
        lowUpperThreshold: policy.low_upper_threshold,
        highLowerThreshold: policy.high_lower_threshold,
        boundaryRule: policy.boundary_rule,
        method: policy.method,
        meaning: policy.meaning,
        developmentStart: policy.development_start,
        developmentEndExclusive: policy.development_end_exclusive,
        labelCutoffExclusive: policy.label_cutoff_exclusive,
        developmentRows: policy.development_rows,
        calibrationEceUniform10: policy.calibration_ece_uniform_10,
        warnings: [...policy.warnings],
        status: policy.status,
        approvedBy: null,
        operationalUseAllowed: false,
      })),
    };
  }
}
