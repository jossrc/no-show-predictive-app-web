import { ConflictException } from '../../../../shared/errors/business/ConflictException.js';
import type { RetentionIneligibilityReason } from '../rules/RetentionEligibility.js';

/** La reserva no cumple retention_priority_v1: se lanza antes de cualquier INSERT. */
export class RetentionNotEligibleException extends ConflictException {
  static readonly CODE = 'RETENTION_NOT_ELIGIBLE';

  constructor(readonly reasons: readonly RetentionIneligibilityReason[]) {
    super({
      message: 'La reserva no cumple las condiciones para registrar una acción de retención',
      code: RetentionNotEligibleException.CODE,
      details: { reasons },
    });
  }
}
