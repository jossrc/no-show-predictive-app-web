import { BaseException } from '../BaseException.js';
import type { ExceptionDetails, ExceptionMetadata } from '../ExceptionMetadata.js';
import type { ValidationError } from './ValidationError.js';

export interface ValidationExceptionProps {
  errors: readonly ValidationError[];
  message?: string;
  code?: string;
  metadata?: ExceptionMetadata | undefined;
  details?: ExceptionDetails | undefined;
  cause?: unknown;
}

export class ValidationException extends BaseException {
  readonly errors: readonly ValidationError[];

  constructor(props: ValidationExceptionProps) {
    super({
      message: props.message ?? 'La solicitud contiene datos inválidos',
      code: props.code ?? 'VALIDATION_ERROR',
      category: 'VALIDATION',
      metadata: props.metadata,
      details: props.details,
      cause: props.cause,
    });

    this.errors = props.errors;
  }
}
