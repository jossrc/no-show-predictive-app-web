import { ConflictException } from '../../../../shared/errors/business/ConflictException.js';

/** El run/modelo indicado no es una predicción persistida de ESTA reserva (o no existe). */
export class PredictionReservationMismatchException extends ConflictException {
  static readonly CODE = 'PREDICTION_RESERVATION_MISMATCH';

  constructor() {
    super({
      message: 'La predicción indicada no corresponde a esta reserva',
      code: PredictionReservationMismatchException.CODE,
    });
  }
}
