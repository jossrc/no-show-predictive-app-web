import type { MlOperation } from './MlHttpErrorMapper.js';

export interface MlTimeoutBudgets {
  /** predict/compare/batch/models/ready. */
  readonly defaultMs: number;
  /** SHAP RF midió ≈1.44 s p50 en macOS local con datos sintéticos: no es SLA. */
  readonly explanationMs: number;
}

/**
 * Presupuesto de tiempo por operación. Un timeout HTTP NO cancela el trabajo ya admitido
 * por Python; por eso no hay reintento automático tras timeout.
 */
export class MlTimeoutPolicy {
  constructor(private readonly budgets: MlTimeoutBudgets) {}

  timeoutFor(operation: MlOperation): number {
    return operation === 'explain' ? this.budgets.explanationMs : this.budgets.defaultMs;
  }
}
