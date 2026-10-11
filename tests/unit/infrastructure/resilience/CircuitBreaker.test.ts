import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CircuitBreaker } from '../../../../src/infrastructure/resilience/CircuitBreaker.js';

describe('CircuitBreaker (CLOSED → OPEN → HALF_OPEN)', () => {
  it('abre tras N fallos consecutivos y rechaza durante el enfriamiento', () => {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, nowMs: () => now });
    breaker.recordFailure();
    assert.equal(breaker.state, 'CLOSED');
    breaker.recordFailure();
    assert.equal(breaker.state, 'OPEN');
    assert.equal(breaker.tryAcquire(), false);
    now = 999;
    assert.equal(breaker.tryAcquire(), false);
  });

  it('HALF_OPEN permite una sola sonda; éxito cierra, fallo reabre', () => {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 100, nowMs: () => now });
    breaker.recordFailure();
    now = 100;
    assert.equal(breaker.tryAcquire(), true);
    assert.equal(breaker.state, 'HALF_OPEN');
    assert.equal(breaker.tryAcquire(), false, 'segunda sonda concurrente');
    breaker.recordFailure();
    assert.equal(breaker.state, 'OPEN');
    now = 200;
    assert.equal(breaker.tryAcquire(), true);
    breaker.recordSuccess();
    assert.equal(breaker.state, 'CLOSED');
  });

  it('respuestas neutrales (4xx) no abren; releaseProbe libera la sonda sin concluir', () => {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10, nowMs: () => now });
    breaker.recordNeutral();
    assert.equal(breaker.state, 'CLOSED');
    breaker.recordFailure();
    now = 10;
    assert.equal(breaker.tryAcquire(), true);
    breaker.releaseProbe();
    assert.equal(breaker.state, 'HALF_OPEN');
    assert.equal(breaker.tryAcquire(), true);
    breaker.recordNeutral();
    assert.equal(breaker.state, 'CLOSED');
  });
});
