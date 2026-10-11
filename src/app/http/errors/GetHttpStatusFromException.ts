import type { NormalizedException } from './NormalizedException.js';

export function getHttpStatusFromException(exception: NormalizedException): number {
  switch (exception.kind) {
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
      return 409;
    case 'INVALID_OPERATION':
    case 'APPLICATION_VALIDATION':
    case 'BUSINESS':
      return 422;
    case 'REQUEST_VALIDATION':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'INFRASTRUCTURE':
      return 503;
    case 'UPSTREAM_TIMEOUT':
      return 504;
    case 'UPSTREAM_RATE_LIMITED':
      return 429;
    case 'UPSTREAM_CONTRACT':
      return 502;
    case 'HTTP_CLIENT':
      return exception.httpStatus ?? 400;
    case 'UNKNOWN':
      return 500;
  }
}
