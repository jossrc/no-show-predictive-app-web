import type { FastifyRequest } from 'fastify';
import type { NormalizedException } from '../NormalizedException.js';
import { buildExceptionReport } from './BuildExceptionReport.js';
import type { ExceptionReporter } from './ExceptionReporter.js';

export async function reportException(
  exception: NormalizedException,
  request: FastifyRequest,
  reporters: readonly ExceptionReporter[],
): Promise<void> {
  const report = buildExceptionReport(exception, request);
  const context = {
    logger: request.log,
    originalError: exception.originalError,
  };

  const results = await Promise.allSettled(
    reporters.map((reporter) => Promise.resolve(reporter.report(report, context))),
  );

  for (const [index, result] of results.entries()) {
    if (result.status !== 'rejected') continue;

    try {
      request.log.error(
        {
          err: result.reason,
          reporter: reporters[index]?.name,
          originalErrorCode: exception.code,
        },
        'Failed to report exception',
      );
    } catch {
      // A reporter must never replace the original application error.
    }
  }
}
