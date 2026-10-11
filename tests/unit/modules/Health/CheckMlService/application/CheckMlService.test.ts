import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MlUnavailableException } from '../../../../../../src/infrastructure/http/ml/errors/MlUnavailableException.js';
import { CheckMlService } from '../../../../../../src/modules/Health/CheckMlService/application/CheckMlService.js';
import { FakePredictionClient } from '../../../../../helpers/FakePredictionClient.js';

describe('CheckMlService', () => {
  it('ok / error / disabled con mensajes estáticos y estado exploratorio', async () => {
    const ml = new FakePredictionClient();
    assert.equal(
      (await new CheckMlService(ml, true).execute({ requestId: 'r' })).servingStatus,
      'EXPLORATORY_NOT_VALIDATED',
    );
    ml.failWith(
      'ready',
      new MlUnavailableException({ code: 'ML_UNAVAILABLE', operation: 'ready' }),
    );
    const failed = await new CheckMlService(ml, true).execute({ requestId: 'r' });
    assert.deepEqual(
      [failed.status, failed.message],
      ['error', 'Servicio de predicción no disponible'],
    );
    assert.equal(
      (await new CheckMlService(ml, false).execute({ requestId: 'r' })).status,
      'disabled',
    );
  });
});
