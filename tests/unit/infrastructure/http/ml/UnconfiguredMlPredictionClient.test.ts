import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UnconfiguredMlPredictionClient } from '../../../../../src/infrastructure/http/ml/UnconfiguredMlPredictionClient.js';
import { MlUnavailableException } from '../../../../../src/infrastructure/http/ml/errors/MlUnavailableException.js';

describe('UnconfiguredMlPredictionClient (sin ML_SERVICE_KEY)', () => {
  it('toda operación falla con ML_NOT_CONFIGURED; nunca devuelve un score', async () => {
    const client = new UnconfiguredMlPredictionClient();
    const calls = [
      client.getModels(),
      client.ready(),
      client.predict(),
      client.compare(),
      client.explain(),
      client.batch(),
    ];
    for (const call of calls) {
      await assert.rejects(
        call,
        (error: unknown) =>
          error instanceof MlUnavailableException && error.code === 'ML_NOT_CONFIGURED',
      );
    }
  });
});
