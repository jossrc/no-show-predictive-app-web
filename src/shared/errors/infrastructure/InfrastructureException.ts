import { BaseException } from '../BaseException.js';
import type { ExceptionMetadata } from '../ExceptionMetadata.js';

export interface InfrastructureExceptionProps {
  message: string;
  code: string;
  metadata?: ExceptionMetadata | undefined;
  cause?: unknown;
}

export abstract class InfrastructureException extends BaseException {
  constructor(props: InfrastructureExceptionProps) {
    super({ ...props, category: 'INFRASTRUCTURE' });
  }
}
