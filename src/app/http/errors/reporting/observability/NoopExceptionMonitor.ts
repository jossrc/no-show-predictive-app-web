import type { ExceptionMonitor } from './ExceptionMonitor.js';

export class NoopExceptionMonitor implements ExceptionMonitor {
  capture(): void {
    // Monitoring is intentionally disabled until an adapter is configured.
  }
}
