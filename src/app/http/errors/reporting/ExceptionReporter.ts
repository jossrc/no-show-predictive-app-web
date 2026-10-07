import type { FastifyBaseLogger } from 'fastify';
import type { ExceptionReport } from './ExceptionReport.js';

export interface ExceptionReporterContext {
  logger: FastifyBaseLogger;
  originalError: unknown;
}

export interface ExceptionReporter {
  readonly name: string;
  report(report: ExceptionReport, context: ExceptionReporterContext): Promise<void> | void;
}
