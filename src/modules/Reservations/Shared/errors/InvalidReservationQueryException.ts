import { ValidationException } from '../../../../shared/errors/validation/ValidationException.js';

export class InvalidReservationQueryException extends ValidationException {
  constructor(
    code: 'INVALID_PERIOD' | 'INVALID_CURSOR' | 'UNKNOWN_CLINIC',
    field: string,
    message: string,
  ) {
    super({
      code,
      message,
      errors: [{ field, code, message, source: 'querystring' }],
    });
  }
}
