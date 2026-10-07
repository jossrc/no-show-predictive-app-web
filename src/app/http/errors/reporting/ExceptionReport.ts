import type {
  NormalizedExceptionCategory,
  NormalizedExceptionKind,
} from '../NormalizedException.js';

export interface ExceptionReport {
  timestamp: string;
  requestId: string;
  method: string;
  url: string;
  exception: {
    name: string;
    code: string;
    category: NormalizedExceptionCategory;
    kind: NormalizedExceptionKind;
    message: string;
    metadata?: Readonly<Record<string, unknown>>;
    stack?: string;
  };
}
