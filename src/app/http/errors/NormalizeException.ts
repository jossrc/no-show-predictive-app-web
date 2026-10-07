import type { FastifySchemaValidationError, SchemaErrorDataVar } from 'fastify/types/schema.js';
import { BaseException } from '../../../shared/errors/BaseException.js';
import { BusinessException } from '../../../shared/errors/business/BusinessException.js';
import { ConflictException } from '../../../shared/errors/business/ConflictException.js';
import { InvalidOperationException } from '../../../shared/errors/business/InvalidOperationException.js';
import { NotFoundException } from '../../../shared/errors/business/NotFoundException.js';
import { InfrastructureException } from '../../../shared/errors/infrastructure/InfrastructureException.js';
import { UnauthorizedException } from '../../../shared/errors/security/UnauthorizedException.js';
import { ValidationException } from '../../../shared/errors/validation/ValidationException.js';
import type { NormalizedException, NormalizedExceptionKind } from './NormalizedException.js';
import { mapFastifyValidationErrors } from './validation/MapFastifyValidationErrors.js';

interface FastifyValidationException extends Error {
  validation: FastifySchemaValidationError[];
  validationContext: SchemaErrorDataVar;
}

interface HttpClientException extends Error {
  statusCode: number;
}

function isFastifyValidationException(error: unknown): error is FastifyValidationException {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Partial<FastifyValidationException>;

  return (
    Array.isArray(candidate.validation) &&
    ['body', 'headers', 'params', 'querystring'].includes(candidate.validationContext ?? '')
  );
}

function isHttpClientException(error: unknown): error is HttpClientException {
  if (!(error instanceof Error)) {
    return false;
  }

  const statusCode = (error as Partial<HttpClientException>).statusCode;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500;
}

function getBaseExceptionKind(error: BaseException): NormalizedExceptionKind {
  if (error instanceof NotFoundException) return 'NOT_FOUND';
  if (error instanceof ConflictException) return 'CONFLICT';
  if (error instanceof InvalidOperationException) return 'INVALID_OPERATION';
  if (error instanceof UnauthorizedException) return 'UNAUTHORIZED';
  if (error instanceof ValidationException) return 'APPLICATION_VALIDATION';
  if (error instanceof InfrastructureException) return 'INFRASTRUCTURE';
  if (error instanceof BusinessException) return 'BUSINESS';

  switch (error.category) {
    case 'BUSINESS':
      return 'BUSINESS';
    case 'VALIDATION':
      return 'APPLICATION_VALIDATION';
    case 'INFRASTRUCTURE':
      return 'INFRASTRUCTURE';
  }
}

function getHttpClientCode(statusCode: number): string {
  const codes: Readonly<Record<number, string>> = {
    400: 'INVALID_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'ROUTE_NOT_FOUND',
    405: 'METHOD_NOT_ALLOWED',
    408: 'REQUEST_TIMEOUT',
    413: 'PAYLOAD_TOO_LARGE',
    415: 'UNSUPPORTED_MEDIA_TYPE',
    429: 'TOO_MANY_REQUESTS',
  };

  return codes[statusCode] ?? 'REQUEST_ERROR';
}

export function normalizeException(error: unknown): NormalizedException {
  if (isFastifyValidationException(error)) {
    return {
      name: error.name,
      code: 'REQUEST_VALIDATION_ERROR',
      message: 'La solicitud contiene datos inválidos',
      category: 'VALIDATION',
      kind: 'REQUEST_VALIDATION',
      errors: mapFastifyValidationErrors(error.validation, error.validationContext),
      cause: error.cause,
      stack: error.stack,
      originalError: error,
    };
  }

  if (error instanceof BaseException) {
    return {
      name: error.name,
      code: error.code,
      message: error.message,
      category: error.category,
      kind: getBaseExceptionKind(error),
      metadata: error.metadata,
      details: error.details,
      errors: error instanceof ValidationException ? error.errors : undefined,
      cause: error.cause,
      stack: error.stack,
      originalError: error,
    };
  }

  if (isHttpClientException(error)) {
    return {
      name: error.name,
      code: getHttpClientCode(error.statusCode),
      message: error.message,
      category: 'UNKNOWN',
      kind: 'HTTP_CLIENT',
      cause: error.cause,
      stack: error.stack,
      httpStatus: error.statusCode,
      originalError: error,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      code: 'INTERNAL_ERROR',
      message: error.message,
      category: 'UNKNOWN',
      kind: 'UNKNOWN',
      cause: error.cause,
      stack: error.stack,
      originalError: error,
    };
  }

  return {
    name: 'UnknownThrownValue',
    code: 'INTERNAL_ERROR',
    message: 'Se lanzó un valor que no es una instancia de Error',
    category: 'UNKNOWN',
    kind: 'UNKNOWN',
    originalError: error,
  };
}
