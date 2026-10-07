import type { ExceptionReport } from '../ExceptionReport.js';
import type { ExceptionReporter } from '../ExceptionReporter.js';
import type { ExceptionReportStore } from './ExceptionReportStore.js';

export class PersistenceExceptionReporter implements ExceptionReporter {
  readonly name = 'persistence';

  constructor(private readonly store: ExceptionReportStore) {}

  async report(report: ExceptionReport): Promise<void> {
    if (!['INFRASTRUCTURE', 'UNKNOWN'].includes(report.exception.kind)) return;
    await this.store.save(report);
  }
}
