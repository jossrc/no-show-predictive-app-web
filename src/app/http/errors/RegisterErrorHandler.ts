import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildErrorResponse } from './BuildErrorResponse.js';
import { getHttpStatusFromException } from './GetHttpStatusFromException.js';
import { normalizeException } from './NormalizeException.js';
import type { NormalizedException } from './NormalizedException.js';
import { createDefaultExceptionReporters } from './reporting/CreateDefaultExceptionReporters.js';
import type { ExceptionReporter } from './reporting/ExceptionReporter.js';
import { reportException } from './reporting/ReportException.js';

export interface RegisterErrorHandlerOptions {
  reporters?: readonly ExceptionReporter[] | undefined;
}

async function safelyReport(
  exception: NormalizedException,
  request: FastifyRequest,
  reporters: readonly ExceptionReporter[],
): Promise<void> {
  try {
    await reportException(exception, request, reporters);
  } catch (reportError) {
    try {
      request.log.error({ err: reportError }, 'Failed to build or dispatch exception report');
    } catch {
      // Reporting must never interfere with the HTTP error response.
    }
  }
}

export function registerErrorHandler(
  app: FastifyInstance,
  options: RegisterErrorHandlerOptions = {},
): void {
  const reporters = options.reporters ?? createDefaultExceptionReporters();

  app.setErrorHandler(async (error, request, reply): Promise<void> => {
    const exception = normalizeException(error);

    if (!reply.sent) {
      await reply
        .status(getHttpStatusFromException(exception))
        .send(buildErrorResponse(exception, request.id));
    }

    await safelyReport(exception, request, reporters);
  });

  app.setNotFoundHandler(async (request, reply): Promise<void> => {
    const error = Object.assign(new Error('Route not found'), {
      name: 'RouteNotFoundError',
      statusCode: 404,
    });
    const exception = normalizeException(error);

    await reply.status(404).send(buildErrorResponse(exception, request.id));
    await safelyReport(exception, request, reporters);
  });
}
