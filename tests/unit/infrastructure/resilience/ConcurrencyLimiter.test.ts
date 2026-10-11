import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ConcurrencyLimitExceededError,
  ConcurrencyLimiter,
} from '../../../../src/infrastructure/resilience/ConcurrencyLimiter.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('ConcurrencyLimiter (cupo + cola acotada)', () => {
  it('nunca supera el máximo concurrente y rechaza cuando la cola está llena', async () => {
    const limiter = new ConcurrencyLimiter(1, 1);
    const gate = deferred();
    let active = 0;
    let peak = 0;
    const task = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await gate.promise;
      active -= 1;
    };

    const first = limiter.run(task);
    const second = limiter.run(task);
    await assert.rejects(limiter.run(task), ConcurrencyLimitExceededError);
    assert.deepEqual([limiter.activeCount, limiter.queuedCount], [1, 1]);
    gate.resolve();
    await Promise.all([first, second]);
    assert.equal(peak, 1);
    assert.deepEqual([limiter.activeCount, limiter.queuedCount], [0, 0]);
  });

  it('una espera abortada sale de la cola sin consumir cupo', async () => {
    const limiter = new ConcurrencyLimiter(1, 2);
    const gate = deferred();
    const running = limiter.run(() => gate.promise);
    const controller = new AbortController();
    const waiting = limiter.run(async () => 'never', controller.signal);
    controller.abort(new Error('timeout'));
    await assert.rejects(waiting, /timeout/);
    assert.equal(limiter.queuedCount, 0);
    gate.resolve();
    await running;
    assert.equal(limiter.activeCount, 0);
    assert.throws(() => new ConcurrencyLimiter(0, 0), RangeError);
  });
});
