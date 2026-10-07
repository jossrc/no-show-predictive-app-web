import { BaseException } from '../BaseException.js';
import type { ExceptionMetadata } from '../ExceptionMetadata.js';

export interface UnauthorizedExceptionProps {
  message?: string;
  metadata?: ExceptionMetadata | undefined;
  cause?: unknown;
}

export class UnauthorizedException extends BaseException {
  static readonly CODE = 'UNAUTHORIZED';

  constructor(props?: UnauthorizedExceptionProps) {
    super({
      message: props?.message ?? 'Autenticación requerida',
      code: UnauthorizedException.CODE,
      category: 'VALIDATION',
      metadata: props?.metadata,
      cause: props?.cause,
    });
  }
}
