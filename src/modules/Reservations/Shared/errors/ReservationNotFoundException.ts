import { NotFoundException } from '../../../../shared/errors/business/NotFoundException.js';

/** Reserva inexistente, excluida (borrador/copia/bloqueo) o fuera del alcance del principal. */
export class ReservationNotFoundException extends NotFoundException {
  static readonly CODE = 'RESERVATION_NOT_FOUND';

  constructor() {
    super({ message: 'Reserva no encontrada', code: ReservationNotFoundException.CODE });
  }
}
