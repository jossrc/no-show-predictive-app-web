import { InvalidOperationException } from '../../../../shared/errors/business/InvalidOperationException.js';

export interface SafeFieldIssue {
  readonly field: string;
  readonly reason: string;
}

/** Python rechazó las predictoras (422). Solo se devuelven nombres de campo y motivo, no valores. */
export class MlInvalidFeaturesException extends InvalidOperationException {
  static readonly CODE = 'INVALID_FEATURES';

  constructor(props: { operation: string; issues: readonly SafeFieldIssue[] }) {
    super({
      message: 'Las variables predictoras no cumplen el contrato del modelo',
      code: MlInvalidFeaturesException.CODE,
      metadata: { operation: props.operation },
      details: { issues: props.issues.slice(0, 20), source: 'ML_SERVICE' },
    });
  }
}
