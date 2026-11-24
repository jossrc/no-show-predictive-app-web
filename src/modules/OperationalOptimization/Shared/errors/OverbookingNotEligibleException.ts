import { ConflictException } from '../../../../shared/errors/business/ConflictException.js';
import type { OverbookingIneligibilityReason } from '../rules/OverbookingEligibility.js';

/** HU-06: el horario no cumple overbooking_eligibility_v1. Se lanza antes de cualquier INSERT. */
export class OverbookingNotEligibleException extends ConflictException {
  static readonly CODE = 'OVERBOOKING_NOT_ELIGIBLE';

  constructor(readonly reasons: readonly OverbookingIneligibilityReason[]) {
    super({
      message: 'El horario no cumple las condiciones para habilitar sobreasignación',
      code: OverbookingNotEligibleException.CODE,
      details: { reasons },
    });
  }
}
