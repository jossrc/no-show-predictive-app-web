import type { ExceptionCategory } from '../../../shared/errors/ExceptionCategory.js';
import type {
  ExceptionDetails,
  ExceptionMetadata,
} from '../../../shared/errors/ExceptionMetadata.js';
import type { ValidationError } from '../../../shared/errors/validation/ValidationError.js';

export type NormalizedExceptionCategory = ExceptionCategory | 'UNKNOWN';

export type NormalizedExceptionKind =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_OPERATION'
  | 'BUSINESS'
  | 'APPLICATION_VALIDATION'
  | 'REQUEST_VALIDATION'
  | 'UNAUTHORIZED'
  | 'INFRASTRUCTURE'
  | 'HTTP_CLIENT'
  | 'UNKNOWN';

export interface NormalizedException {
  name: string;
  code: string;
  message: string;
  category: NormalizedExceptionCategory;
  kind: NormalizedExceptionKind;
  metadata?: ExceptionMetadata | undefined;
  details?: ExceptionDetails | undefined;
  errors?: readonly ValidationError[] | undefined;
  cause?: unknown;
  stack?: string | undefined;
  httpStatus?: number | undefined;
  originalError: unknown;
}
