import { ConflictException } from '../../../../shared/errors/business/ConflictException.js';
import {
  APPOINTMENT_NOT_FINISHED_MESSAGES,
  type AppointmentNotFinishedCode,
} from '../rules/AppointmentFinished.js';

/** HU-07: la fuente no acredita que la cita terminó (appointment_finished_rule_v1). */
export class AppointmentNotFinishedException extends ConflictException {
  static readonly CODE = 'APPOINTMENT_NOT_FINISHED';

  constructor(reason: Exclude<AppointmentNotFinishedCode, 'RESERVATION_CANCELLED'>) {
    super({
      message: 'La cita no ha finalizado de forma verificable',
      code: AppointmentNotFinishedException.CODE,
      details: { reason, reasonMessage: APPOINTMENT_NOT_FINISHED_MESSAGES[reason] },
    });
  }
}
