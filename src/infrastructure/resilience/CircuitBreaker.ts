export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  readonly failureThreshold: number;
  readonly cooldownMs: number;
  readonly nowMs?: () => number;
}

/**
 * Circuit breaker mínimo: CLOSED → OPEN tras N fallos consecutivos de transporte/servidor,
 * OPEN rechaza sin llamar durante el enfriamiento, HALF_OPEN permite UNA sonda.
 */
export class CircuitBreaker {
  private currentState: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAtMs = 0;
  private probeInFlight = false;
  private readonly nowMs: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.nowMs = options.nowMs ?? Date.now;
  }

  get state(): CircuitState {
    return this.currentState;
  }

  /** Devuelve false si la llamada debe rechazarse sin contactar al servicio. */
  tryAcquire(): boolean {
    if (this.currentState === 'CLOSED') return true;

    if (this.currentState === 'OPEN') {
      if (this.nowMs() - this.openedAtMs < this.options.cooldownMs) return false;
      this.currentState = 'HALF_OPEN';
      this.probeInFlight = false;
    }

    if (this.probeInFlight) return false;
    this.probeInFlight = true;
    return true;
  }

  recordSuccess(): void {
    this.currentState = 'CLOSED';
    this.consecutiveFailures = 0;
    this.probeInFlight = false;
  }

  recordFailure(): void {
    if (this.currentState === 'HALF_OPEN') {
      this.open();
      return;
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.options.failureThreshold) {
      this.open();
    }
  }

  /** Respuesta que no indica degradación del servicio (p. ej. 4xx de contrato). */
  recordNeutral(): void {
    if (this.currentState === 'HALF_OPEN') {
      this.recordSuccess();
    }
  }

  /** Libera la sonda HALF_OPEN sin concluir nada sobre la salud del servicio. */
  releaseProbe(): void {
    if (this.currentState === 'HALF_OPEN') {
      this.probeInFlight = false;
    }
  }

  private open(): void {
    this.currentState = 'OPEN';
    this.openedAtMs = this.nowMs();
    this.probeInFlight = false;
  }
}
