import type { ExceptionReport } from '../ExceptionReport.js';
import type { ExceptionReporter, ExceptionReporterContext } from '../ExceptionReporter.js';
import type { ExceptionMonitor } from './ExceptionMonitor.js';

export class ObservabilityExceptionReporter implements ExceptionReporter {
  readonly name = 'observability';

  constructor(private readonly monitor: ExceptionMonitor) {}

  async report(report: ExceptionReport, context: ExceptionReporterContext): Promise<void> {
    if (!['INFRASTRUCTURE', 'UNKNOWN'].includes(report.exception.kind)) return;
    await this.monitor.capture(report, context.originalError);
  }
}
