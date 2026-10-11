import type { ExceptionMetadata } from '../../../shared/errors/ExceptionMetadata.js';
import { InfrastructureException } from '../../../shared/errors/infrastructure/InfrastructureException.js';

export interface PersistenceUnavailableExceptionProps {
  operation: string;
  reason?: 'QUERY_FAILED' | 'PREDICTIVE_SCHEMA_NOT_MIGRATED' | 'TIMEOUT';
  metadata?: ExceptionMetadata | undefined;
  cause?: unknown;
}

/** Fallo del almacén predictivo propio (schema ml). Nunca expone SQL ni stack al cliente. */
export class PersistenceUnavailableException extends InfrastructureException {
  static readonly CODE = 'PERSISTENCE_UNAVAILABLE';

  constructor(props: PersistenceUnavailableExceptionProps) {
    super({
      message: 'El almacén predictivo no está disponible',
      code: PersistenceUnavailableException.CODE,
      metadata: {
        ...props.metadata,
        operation: props.operation,
        reason: props.reason ?? 'QUERY_FAILED',
      },
      cause: props.cause,
    });
  }
}
