import type { ExceptionReport } from '../ExceptionReport.js';

/** Adapter port for a future error monitoring service (Sentry, Datadog, etc.). */
export interface ExceptionMonitor {
  capture(report: ExceptionReport, originalError: unknown): Promise<void> | void;
}
