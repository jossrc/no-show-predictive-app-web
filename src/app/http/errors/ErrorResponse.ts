import type { ExceptionDetails } from '../../../shared/errors/ExceptionMetadata.js';
import type { ValidationError } from '../../../shared/errors/validation/ValidationError.js';

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    errors?: readonly ValidationError[];
    details?: ExceptionDetails;
  };
  requestId: string;
}
