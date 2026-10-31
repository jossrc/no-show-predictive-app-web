import { InvalidOperationException } from '../../../../shared/errors/business/InvalidOperationException.js';
import type { FeatureIssue } from '../validation/ValidateFeatureSnapshot.js';

/** Predictoras incoherentes detectadas en Node: no se envían a Python. */
export class InvalidFeatureSnapshotException extends InvalidOperationException {
  static readonly CODE = 'INVALID_FEATURES';

  constructor(readonly issues: readonly FeatureIssue[]) {
    super({
      message: 'Las variables predictoras no cumplen el contrato del modelo',
      code: InvalidFeatureSnapshotException.CODE,
      details: { issues: issues.slice(0, 20), source: 'BACKEND_VALIDATION' },
    });
  }
}
