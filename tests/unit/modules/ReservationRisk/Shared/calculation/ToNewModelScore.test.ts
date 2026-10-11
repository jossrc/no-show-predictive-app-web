import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MlPredictionResponse } from '../../../../../../src/infrastructure/http/ml/MlContractTypes.js';
import { toNewModelScore } from '../../../../../../src/modules/ReservationRisk/Shared/calculation/ToNewModelScore.js';
import { PendingValidationRiskLevelPolicy } from '../../../../../../src/modules/ReservationRisk/Shared/policy/PendingValidationRiskLevelPolicy.js';
import { FakeRiskPolicy } from '../../../../../helpers/FakeRiskPolicy.js';
import { loadMlGolden } from '../../../../../helpers/LoadFixture.js';
import { makeStoredSnapshot } from '../../../../../helpers/MakeSyntheticReservation.js';

describe('ToNewModelScore', () => {
  const response = loadMlGolden<MlPredictionResponse>('golden_predict_rf');
  const snapshot = makeStoredSnapshot();
  const scoredAt = new Date('2026-10-25T00:00:00Z');

  it('preserva probabilidad sin redondeo, identidad y prediction_at del snapshot; nivel null pendiente', () => {
    const score = toNewModelScore(
      response,
      snapshot,
      scoredAt,
      new PendingValidationRiskLevelPolicy(),
    );
    assert.equal(score.probabilityNoShow, 0.6976400433344135);
    assert.equal(score.predictionAt, snapshot.predictionAt);
    assert.deepEqual(
      [score.riskLevel, score.riskPolicyVersion, score.riskPolicyStatus],
      [null, null, 'pending_validation'],
    );
    assert.equal(score.operationalUseAllowed, false);
  });

  it('solo una política aprobada (sintética de prueba) asigna nivel y versión', () => {
    const score = toNewModelScore(response, snapshot, scoredAt, new FakeRiskPolicy());
    assert.deepEqual(
      [score.riskLevel, score.riskPolicyVersion, score.riskPolicyStatus],
      ['HIGH', 'SYNTHETIC_TEST_ONLY_POLICY', 'approved'],
    );
  });
});
