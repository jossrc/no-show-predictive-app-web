import type { ExceptionReport } from './ExceptionReport.js';
import type { ExceptionReporter, ExceptionReporterContext } from './ExceptionReporter.js';

export class PinoExceptionReporter implements ExceptionReporter {
  readonly name = 'pino';

  report(report: ExceptionReport, context: ExceptionReporterContext): void {
    const logData = {
      err: context.originalError,
      event: 'application_error',
      requestId: report.requestId,
      method: report.method,
      url: report.url,
      exception: report.exception,
    };

    if (report.exception.kind === 'INFRASTRUCTURE' || report.exception.kind === 'UNKNOWN') {
      context.logger.error(logData, report.exception.message);
      return;
    }

    if (report.exception.category === 'VALIDATION') {
      context.logger.debug(logData, report.exception.message);
      return;
    }

    context.logger.warn(logData, report.exception.message);
  }
}
