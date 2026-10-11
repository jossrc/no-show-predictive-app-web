import { ConflictException } from '../../../../shared/errors/business/ConflictException.js';

/** Sin instante de creación de la reserva no existe corte booking_creation demostrable. */
export class HistoryCutoffUnavailableException extends ConflictException {
  static readonly CODE = 'HISTORY_CUTOFF_UNAVAILABLE';

  constructor() {
    super({
      message: 'La reserva no registra su instante de creación; use historicalAsOf=current_known',
      code: HistoryCutoffUnavailableException.CODE,
    });
  }
}
