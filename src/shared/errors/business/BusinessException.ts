import { BaseException } from '../BaseException.js';
import type { ExceptionDetails, ExceptionMetadata } from '../ExceptionMetadata.js';

export interface BusinessExceptionProps {
  message: string;
  code: string;
  metadata?: ExceptionMetadata | undefined;
  details?: ExceptionDetails | undefined;
  cause?: unknown;
}

export abstract class BusinessException extends BaseException {
  constructor(props: BusinessExceptionProps) {
    super({ ...props, category: 'BUSINESS' });
  }
}
