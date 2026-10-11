export class ConcurrencyLimitExceededError extends Error {
  constructor() {
    super('Cupo de concurrencia y cola agotados');
    this.name = 'ConcurrencyLimitExceededError';
  }
}

interface Waiter {
  resolve: () => void;
  reject: (reason: unknown) => void;
  detach: () => void;
}

/**
 * Semáforo en memoria con cola acotada. Si la cola está llena rechaza de inmediato
 * (backpressure) en lugar de acumular solicitudes sin límite.
 */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueued: number,
  ) {
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new RangeError('maxConcurrent debe ser un entero >= 1');
    }
    if (!Number.isSafeInteger(maxQueued) || maxQueued < 0) {
      throw new RangeError('maxQueued debe ser un entero >= 0');
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.waiters.length;
  }

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }

    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }

    if (this.waiters.length >= this.maxQueued) {
      return Promise.reject(new ConcurrencyLimitExceededError());
    }

    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(signal?.reason);
      };
      const waiter: Waiter = {
        resolve,
        reject,
        detach: () => signal?.removeEventListener('abort', onAbort),
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    const next = this.waiters.shift();

    if (next) {
      // El cupo se transfiere directamente al siguiente en cola.
      next.detach();
      next.resolve();
      return;
    }

    this.active -= 1;
  }
}
