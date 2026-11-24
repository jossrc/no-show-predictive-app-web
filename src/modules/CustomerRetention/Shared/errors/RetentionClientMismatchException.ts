import { ConflictException } from '../../../../shared/errors/business/ConflictException.js';

/** El cliente indicado no es el titular de la reserva (no se revela cuál es). */
export class RetentionClientMismatchException extends ConflictException {
  static readonly CODE = 'RESERVATION_CLIENT_MISMATCH';

  constructor() {
    super({
      message: 'El cliente indicado no corresponde a la reserva',
      code: RetentionClientMismatchException.CODE,
    });
  }
}
