import { ConflictException } from '../../../../shared/errors/business/ConflictException.js';

/** HU-06: ya existe una marca con OTRA predicción; la marca histórica nunca se reemplaza. */
export class OverbookingAlreadyEnabledConflictException extends ConflictException {
  static readonly CODE = 'OVERBOOKING_ALREADY_ENABLED_CONFLICT';

  constructor(existing: { authorizationId: string; modelKey: string; predictionRunId: string }) {
    super({
      message: 'El horario ya fue habilitado con otra predicción; la marca no se reemplaza',
      code: OverbookingAlreadyEnabledConflictException.CODE,
      details: { ...existing },
    });
  }
}
