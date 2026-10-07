import type { ExceptionCategory } from './ExceptionCategory.js';
import type { ExceptionDetails, ExceptionMetadata } from './ExceptionMetadata.js';

export interface BaseExceptionProps {
  message: string;
  code: string;
  category: ExceptionCategory;
  metadata?: ExceptionMetadata | undefined;
  details?: ExceptionDetails | undefined;
  cause?: unknown;
}

export abstract class BaseException extends Error {
  readonly code: string;
  readonly category: ExceptionCategory;
  readonly metadata: ExceptionMetadata | undefined;
  readonly details: ExceptionDetails | undefined;

  constructor(props: BaseExceptionProps) {
    super(props.message, { cause: props.cause });

    this.name = new.target.name;
    this.code = props.code;
    this.category = props.category;
    this.metadata = props.metadata;
    this.details = props.details;

    Error.captureStackTrace?.(this, new.target);
  }
}
