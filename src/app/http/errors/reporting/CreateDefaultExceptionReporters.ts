import type { ExceptionReporter } from './ExceptionReporter.js';
import { PinoExceptionReporter } from './PinoExceptionReporter.js';
import { NoopExceptionMonitor } from './observability/NoopExceptionMonitor.js';
import { ObservabilityExceptionReporter } from './observability/ObservabilityExceptionReporter.js';
import { NoopExceptionReportStore } from './persistence/NoopExceptionReportStore.js';
import { PersistenceExceptionReporter } from './persistence/PersistenceExceptionReporter.js';

export function createDefaultExceptionReporters(): readonly ExceptionReporter[] {
  return [
    new PinoExceptionReporter(),
    new ObservabilityExceptionReporter(new NoopExceptionMonitor()),
    new PersistenceExceptionReporter(new NoopExceptionReportStore()),
  ];
}
