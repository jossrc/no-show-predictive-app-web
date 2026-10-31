import type { RiskLevel, RiskLevelPolicy } from './RiskLevelPolicy.js';

/**
 * Estado real del proyecto: FastAPI devuelve risk_level=null y risk_policy_status=
 * pending_validation. No existen umbrales aprobados: nunca se fabrica LOW/MEDIUM/HIGH.
 */
export class PendingValidationRiskLevelPolicy implements RiskLevelPolicy {
  readonly status = 'pending_validation' as const;
  readonly policyVersion = null;

  isAvailableFor(): boolean {
    return false;
  }

  classify(): RiskLevel | null {
    return null;
  }

  bandFor(): null {
    return null;
  }
}
