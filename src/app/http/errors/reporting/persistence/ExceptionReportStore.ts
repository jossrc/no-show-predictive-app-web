import type { ExceptionReport } from '../ExceptionReport.js';

/** Adapter port for optional, complementary error persistence. Pino remains the primary reporter. */
export interface ExceptionReportStore {
  save(report: ExceptionReport): Promise<void> | void;
}
