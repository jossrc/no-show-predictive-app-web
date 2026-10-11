import type { MlModelKey } from '../../../../infrastructure/http/ml/MlFeatureContract.js';

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export type RiskPolicyStatus = 'pending_validation' | 'approved';

export interface ProbabilityBand {
  readonly minInclusive: number;
  readonly maxExclusive: number;
}

/**
 * Política de niveles (semáforo). Solo una política versionada, con modelo/calibración
 * aprobados, puede devolver niveles. Sprint 01 real usa PendingValidationRiskLevelPolicy.
 */
export interface RiskLevelPolicy {
  readonly status: RiskPolicyStatus;
  readonly policyVersion: string | null;
  isAvailableFor(modelKey: MlModelKey): boolean;
  classify(score: {
    modelKey: MlModelKey;
    modelVersion: string;
    probabilityNoShow: number;
  }): RiskLevel | null;
  /** Banda de probabilidad equivalente a un nivel, para filtrar en SQL; null si no aplica. */
  bandFor(level: RiskLevel, modelKey: MlModelKey): ProbabilityBand | null;
}
