import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assembleRiskAssessment } from '../../../../../../src/modules/ReservationRisk/Shared/calculation/AssembleRiskAssessment.js';
import type { ModelScore } from '../../../../../../src/modules/ReservationRisk/Shared/models/ModelScore.js';
import { notScorableReason } from '../../../../../../src/modules/ReservationRisk/Shared/models/NotScorableReason.js';
import { PendingValidationRiskLevelPolicy } from '../../../../../../src/modules/ReservationRisk/Shared/policy/PendingValidationRiskLevelPolicy.js';
import { FakeRiskPolicy } from '../../../../../helpers/FakeRiskPolicy.js';
import { makeStoredSnapshot } from '../../../../../helpers/MakeSyntheticReservation.js';

function score(modelKey: ModelScore['modelKey'], p: number): ModelScore {
  return {
    resultId: '1',
    predictionRunId: 'run',
    snapshotId: '1',
    modelKey,
    algorithm: modelKey === 'xgboost_full_v1' ? 'xgboost' : 'random_forest',
    modelVersion: `${modelKey}:abc123`,
    modelHash: 'abc123',
    featureVersion: 'BOOKING_BASELINE_V1',
    predictionAt: new Date('2026-10-20T16:00:00Z'),
    scoredAt: new Date('2026-10-25T15:00:00Z'),
    probabilityNoShow: p,
    predictionTarget: 'NO_SHOW_CANDIDATE',
    validationStatus: 'EXPLORATORY_NOT_VALIDATED',
    calibrationStatus: 'not_operationally_validated',
    operationalUseAllowed: false,
    riskLevel: null,
    riskPolicyVersion: null,
    riskPolicyStatus: 'pending_validation',
  };
}

const base = {
  reservationId: '1',
  snapshot: makeStoredSnapshot(),
  reasons: [],
  policy: new PendingValidationRiskLevelPolicy(),
  mode: 'READ_ONLY_EXISTING_SCHEDULE' as const,
};

describe('AssembleRiskAssessment', () => {
  it('ordena RF→XGB, comparación descriptiva sin ensemble y niveles null con política pendiente', () => {
    const result = assembleRiskAssessment({
      ...base,
      scores: [score('xgboost_full_v1', 0.9), score('random_forest_full_v1', 0.7)],
    });
    assert.equal(result.status, 'AVAILABLE_EXPLORATORY');
    assert.deepEqual(
      result.models.map((m) => m.modelKey),
      ['random_forest_full_v1', 'xgboost_full_v1'],
    );
    assert.ok(Math.abs((result.comparison?.absoluteProbabilityDifference ?? 0) - 0.2) < 1e-12);
    assert.ok(result.models.every((m) => m.policyRiskLevel === null));
    assert.equal(result.riskPolicyStatus, 'pending_validation');
  });

  it('sin scores: NOT_SCORED con snapshot; NOT_SCORABLE con motivos y sin snapshot', () => {
    assert.equal(assembleRiskAssessment({ ...base, scores: [] }).status, 'NOT_SCORED');
    const blocked = assembleRiskAssessment({
      ...base,
      snapshot: null,
      scores: [],
      reasons: [notScorableReason('MISSING_BOOKING_TIME')],
    });
    assert.equal(blocked.status, 'NOT_SCORABLE');
    assert.equal(blocked.reasons[0]?.code, 'MISSING_BOOKING_TIME');
    assert.equal(blocked.comparison, null);
  });

  it('una política sintética aprobada (solo tests) clasifica únicamente el modelo para el que existe', () => {
    const result = assembleRiskAssessment({
      ...base,
      policy: new FakeRiskPolicy(),
      scores: [score('random_forest_full_v1', 0.7), score('xgboost_full_v1', 0.1)],
    });
    assert.deepEqual(
      result.models.map((m) => m.policyRiskLevel),
      ['HIGH', null],
    );
  });
});
