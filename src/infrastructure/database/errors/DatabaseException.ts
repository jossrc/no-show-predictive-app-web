import type { ExceptionMetadata } from '../../../shared/errors/ExceptionMetadata.js';
import { InfrastructureException } from '../../../shared/errors/infrastructure/InfrastructureException.js';

export interface DatabaseExceptionProps {
  message?: string;
  metadata?: ExceptionMetadata | undefined;
  cause?: unknown;
}

export class DatabaseException extends InfrastructureException {
  static readonly CODE = 'DATABASE_ERROR';

  constructor(props?: DatabaseExceptionProps) {
    super({
      message: props?.message ?? 'Database operation failed',
      code: DatabaseException.CODE,
      metadata: props?.metadata,
      cause: props?.cause,
    });
  }
}
