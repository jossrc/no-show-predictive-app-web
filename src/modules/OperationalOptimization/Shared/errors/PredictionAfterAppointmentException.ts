import { ConflictException } from '../../../../shared/errors/business/ConflictException.js';

/** La predicción se generó después del inicio de la cita: contrastarla tendría fuga temporal. */
export class PredictionAfterAppointmentException extends ConflictException {
  static readonly CODE = 'PREDICTION_AFTER_APPOINTMENT';

  constructor() {
    super({
      message: 'La predicción se registró después del inicio de la cita y no puede contrastarse',
      code: PredictionAfterAppointmentException.CODE,
    });
  }
}
