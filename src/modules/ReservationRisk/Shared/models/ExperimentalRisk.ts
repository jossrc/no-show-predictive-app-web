import type { MlExperimentalRisk } from '../../../../infrastructure/http/ml/MlContractTypes.js';
import type { ExperimentalRiskSummary } from '../../../Reservations/Shared/models/ReservationScoreSummary.js';

export {
  EXPERIMENTAL_RISK_LEVELS,
  type ExperimentalRiskLevel,
} from '../../../Reservations/Shared/models/ReservationScoreSummary.js';

/**
 * Banda relativa EXPERIMENTAL (terciles del score crudo) publicada por la política research v2
 * de Python, persistida tal cual junto al score. NO es el `riskLevel` operativo (que sigue null
 * hasta una política aprobada), no es probabilidad de inasistencia ni autoriza acciones.
 */
export interface ExperimentalRisk extends ExperimentalRiskSummary {
  readonly lowUpperThreshold: number;
  readonly highLowerThreshold: number;
  readonly boundaryRule: string;
  readonly meaning: 'relative_score_band_not_validated_absolute_risk';
  readonly scoreSpace: 'raw_probability_no_show';
  readonly warnings: readonly string[];
  readonly approvedBy: null;
  readonly operationalUseAllowed: false;
}

/** Traducción 1:1 de la respuesta v2 YA validada; Node no recalcula ni corrige la banda. */
export function toExperimentalRisk(risk: MlExperimentalRisk): ExperimentalRisk {
  return {
    level: risk.level,
    label: risk.label,
    status: risk.status,
    policyId: risk.policy_id,
    policyVersion: risk.policy_version,
    policyHash: risk.policy_hash,
    lowUpperThreshold: risk.low_upper_threshold,
    highLowerThreshold: risk.high_lower_threshold,
    boundaryRule: risk.boundary_rule,
    meaning: risk.meaning,
    scoreSpace: risk.score_space,
    warnings: [...risk.warnings],
    approvedBy: null,
    operationalUseAllowed: false,
  };
}

export function summarizeExperimentalRisk(risk: ExperimentalRisk): ExperimentalRiskSummary {
  return {
    level: risk.level,
    label: risk.label,
    status: risk.status,
    policyId: risk.policyId,
    policyVersion: risk.policyVersion,
    policyHash: risk.policyHash,
  };
}
