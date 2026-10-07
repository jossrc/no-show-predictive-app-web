import type { ExceptionReport } from '../ExceptionReport.js';
import type { ExceptionReportStore } from './ExceptionReportStore.js';

export class NoopExceptionReportStore implements ExceptionReportStore {
  save(_report: ExceptionReport): void {
    // Persistence is intentionally disabled until a separate store is configured.
  }
}
