import { ValidationException } from '../../../../shared/errors/validation/ValidationException.js';
import type { ExceptionDetails } from '../../../../shared/errors/ExceptionMetadata.js';
import {
  FILE_ERROR_MESSAGES,
  type ImportFileErrorCode,
} from '../contract/ReservationImportContract.js';

/** Error general del archivo (422): ninguna fila se procesa y no se registra lote. */
export class InvalidImportFileException extends ValidationException {
  constructor(
    readonly reason: ImportFileErrorCode,
    details?: ExceptionDetails,
  ) {
    const message = FILE_ERROR_MESSAGES[reason];
    super({
      code: reason,
      message,
      errors: [{ field: 'file', code: reason, message, source: 'body' }],
      details,
    });
  }
}
