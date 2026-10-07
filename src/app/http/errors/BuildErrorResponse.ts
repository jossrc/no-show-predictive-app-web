import type { ErrorResponse } from './ErrorResponse.js';
import { getPublicErrorMessage } from './GetPublicErrorMessage.js';
import type { NormalizedException } from './NormalizedException.js';

export function buildErrorResponse(
  exception: NormalizedException,
  requestId: string,
): ErrorResponse {
  return {
    error: {
      code: exception.code,
      message: getPublicErrorMessage(exception),
      ...(exception.errors?.length ? { errors: exception.errors } : {}),
      ...(exception.details ? { details: exception.details } : {}),
    },
    requestId,
  };
}
