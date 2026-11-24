import { ConflictException } from '../../../../shared/errors/business/ConflictException.js';
import { APPOINTMENT_NOT_FINISHED_MESSAGES } from '../rules/AppointmentFinished.js';

/** HU-07: una cancelación no se registra ni se fuerza como inasistencia. */
export class ReservationCancelledException extends ConflictException {
  static readonly CODE = 'RESERVATION_CANCELLED';

  constructor() {
    super({
      message: APPOINTMENT_NOT_FINISHED_MESSAGES.RESERVATION_CANCELLED,
      code: ReservationCancelledException.CODE,
    });
  }
}
