import type { MlModelKey } from '../../src/infrastructure/http/ml/MlFeatureContract.js';
import type {
  ProbabilityBand,
  RiskLevel,
  RiskLevelPolicy,
} from '../../src/modules/ReservationRisk/Shared/policy/RiskLevelPolicy.js';

/**
 * POLÍTICA FICTICIA EXCLUSIVA DE PRUEBAS SINTÉTICAS. Sus bandas NO son umbrales científicos,
 * no existen en src/ y no pueden habilitarse por configuración en ningún entorno real.
 */
const SYNTHETIC_TEST_ONLY_BANDS: Readonly<Record<RiskLevel, ProbabilityBand>> = {
  LOW: { minInclusive: 0, maxExclusive: 0.25 },
  MEDIUM: { minInclusive: 0.25, maxExclusive: 0.5 },
  HIGH: { minInclusive: 0.5, maxExclusive: 1.000001 },
};

export class FakeRiskPolicy implements RiskLevelPolicy {
  readonly status = 'approved' as const;
  readonly policyVersion = 'SYNTHETIC_TEST_ONLY_POLICY';

  isAvailableFor(modelKey: MlModelKey): boolean {
    return modelKey === 'random_forest_full_v1';
  }

  classify(score: { modelKey: MlModelKey; probabilityNoShow: number }): RiskLevel | null {
    if (!this.isAvailableFor(score.modelKey)) return null;
    const entry = Object.entries(SYNTHETIC_TEST_ONLY_BANDS).find(
      ([, band]) =>
        score.probabilityNoShow >= band.minInclusive && score.probabilityNoShow < band.maxExclusive,
    );
    return (entry?.[0] as RiskLevel | undefined) ?? null;
  }

  bandFor(level: RiskLevel, modelKey: MlModelKey): ProbabilityBand | null {
    return this.isAvailableFor(modelKey) ? SYNTHETIC_TEST_ONLY_BANDS[level] : null;
  }
}
