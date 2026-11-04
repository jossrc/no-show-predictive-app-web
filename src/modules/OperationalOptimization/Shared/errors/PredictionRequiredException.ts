import { ConflictException } from '../../../../shared/errors/business/ConflictException.js';

/** HU-07: sin predicción previa persistida no hay nada que contrastar (no se infiere). */
export class PredictionRequiredException extends ConflictException {
  static readonly CODE = 'PREDICTION_REQUIRED';

  constructor() {
    super({
      message: 'La reserva no tiene una predicción registrada con la cual contrastar el resultado',
      code: PredictionRequiredException.CODE,
    });
  }
}
