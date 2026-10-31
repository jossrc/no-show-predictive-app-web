import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CachedMlModelCatalog } from '../../../../../src/infrastructure/http/ml/CachedMlModelCatalog.js';
import { FakePredictionClient } from '../../../../helpers/FakePredictionClient.js';

describe('CachedMlModelCatalog', () => {
  it('cachea durante el TTL, deduplica cargas concurrentes y se puede invalidar', async () => {
    const client = new FakePredictionClient();
    let now = 0;
    const catalog = new CachedMlModelCatalog(client, 1000, () => now);
    const context = { requestId: 'r1' };

    await Promise.all([catalog.getModels(context), catalog.getModels(context)]);
    assert.equal(client.callsOf('models').length, 1);
    now = 999;
    assert.equal((await catalog.getModel('xgboost_full_v1', context))?.model_hash, '376d3db9d4d3');
    assert.equal(client.callsOf('models').length, 1);
    now = 1000;
    await catalog.getModels(context);
    assert.equal(client.callsOf('models').length, 2);
    catalog.invalidate();
    await catalog.getModels(context);
    assert.equal(client.callsOf('models').length, 3);
  });
});
