import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessAppointmentFinished } from '../../../../../../src/modules/OperationalOptimization/Shared/rules/AppointmentFinished.js';
import {
  BINARY_OUTCOME_RULE_VERSION,
  BINARY_OUTCOME_THRESHOLD,
  compareWithObservedOutcome,
} from '../../../../../../src/modules/OperationalOptimization/Shared/rules/BinaryOutcomeComparison.js';
import { evaluateOverbookingEligibility } from '../../../../../../src/modules/OperationalOptimization/Shared/rules/OverbookingEligibility.js';
import type { ReservationScoreSummary } from '../../../../../../src/modules/Reservations/Shared/models/ReservationScoreSummary.js';
import { makeReservation } from '../../../../../helpers/MakeSyntheticReservation.js';

const NOW = new Date('2026-11-01T00:00:00Z');
const POLICY = 'a'.repeat(64);

function score(
  modelKey: ReservationScoreSummary['modelKey'],
  level: 'LOW' | 'MEDIUM' | 'HIGH' | null,
  policyHash = POLICY,
): ReservationScoreSummary {
  return {
    modelKey,
    modelVersion: `${modelKey}:abc`,
    modelHash: 'abc',
    probabilityNoShow: 0.7,
    scoredAt: new Date('2026-10-30T00:00:00Z'),
    predictionRunId: `run-${modelKey}`,
    experimentalRisk: level
      ? {
          level,
          label: 'Alto (exploratorio)',
          status: 'RESEARCH_PROVISIONAL',
          policyId: 'p',
          policyVersion: 'research_risk_v1_1',
          policyHash,
        }
      : null,
  };
}

const policies = new Map([
  ['random_forest_full_v1', POLICY],
  ['xgboost_full_v1', POLICY],
] as const);

describe('overbooking_eligibility_v1 (HU-06)', () => {
  it('elegible solo si SCHEDULED, futura y la banda experimental del último score es HIGH (por modelo)', () => {
    const result = evaluateOverbookingEligibility({
      reservation: makeReservation(),
      now: NOW,
      latestScores: [score('xgboost_full_v1', 'MEDIUM'), score('random_forest_full_v1', 'HIGH')],
      currentPolicyHashes: policies,
      alreadyEnabled: false,
    });
    assert.equal(result.eligible, true);
    assert.deepEqual(
      result.candidates.map((c) => [c.modelKey, c.eligible, c.reasons.map((r) => r.code)]),
      [
        ['random_forest_full_v1', true, []],
        ['xgboost_full_v1', false, ['PREDICTION_NOT_HIGH']],
      ],
      'RF y XGB se evalúan por separado, sin ensemble ni ganador',
    );
  });

  it('motivos tipados: no programada, cita no futura, sin scores, sin banda v2, política no vigente, ya habilitada', () => {
    const codes = (overrides: Partial<Parameters<typeof evaluateOverbookingEligibility>[0]>) => {
      const result = evaluateOverbookingEligibility({
        reservation: makeReservation(),
        now: NOW,
        latestScores: [score('random_forest_full_v1', 'HIGH')],
        currentPolicyHashes: policies,
        alreadyEnabled: false,
        ...overrides,
      });
      return [
        result.eligible,
        [...result.reasons, ...result.candidates.flatMap((c) => c.reasons)].map((r) => r.code),
      ];
    };
    assert.deepEqual(codes({ reservation: makeReservation({ status: 'CANCELLED' }) }), [
      false,
      ['RESERVATION_NOT_SCHEDULED'],
    ]);
    assert.deepEqual(codes({ reservation: makeReservation({ status: 'PAST' }) }), [
      false,
      ['RESERVATION_NOT_SCHEDULED'],
    ]);
    assert.deepEqual(
      codes({ now: new Date('2026-11-12T20:00:00.000Z') }),
      [false, ['APPOINTMENT_NOT_FUTURE']],
      'inicio exacto ⇒ ya no es futura',
    );
    assert.deepEqual(codes({ latestScores: [] }), [false, ['NOT_SCORED']]);
    assert.deepEqual(codes({ latestScores: [score('random_forest_full_v1', null)] }), [
      false,
      ['EXPERIMENTAL_BAND_UNAVAILABLE'],
    ]);
    assert.deepEqual(
      codes({ latestScores: [score('random_forest_full_v1', 'HIGH', 'b'.repeat(64))] }),
      [false, ['RESEARCH_POLICY_NOT_CURRENT']],
    );
    assert.deepEqual(codes({ alreadyEnabled: true }), [false, ['ALREADY_ENABLED']]);
    assert.deepEqual(codes({ latestScores: [score('random_forest_full_v1', 'LOW')] }), [
      false,
      ['PREDICTION_NOT_HIGH'],
    ]);
  });
});

describe('binary_outcome_threshold_v1 (HU-07, convención técnica PROVISIONAL)', () => {
  it('borde exacto: p=0.49 no predice inasistencia; p=0.50 sí; coincidencia frente a lo observado', () => {
    assert.equal(BINARY_OUTCOME_THRESHOLD, 0.5);
    assert.equal(BINARY_OUTCOME_RULE_VERSION, 'binary_outcome_threshold_v1');
    assert.deepEqual(compareWithObservedOutcome(0.49, true), {
      comparisonRuleVersion: 'binary_outcome_threshold_v1',
      threshold: 0.5,
      predictedNoShow: false,
      observedNoShow: true,
      matchesPrediction: false,
    });
    assert.equal(compareWithObservedOutcome(0.5, true).matchesPrediction, true);
    assert.equal(compareWithObservedOutcome(0.4999999999999999, false).matchesPrediction, true);
    assert.equal(compareWithObservedOutcome(0.5, false).matchesPrediction, false);
  });
});

describe('appointment_finished_rule_v1 (HU-07)', () => {
  const end = async () => new Date('2026-11-12T20:40:00.000Z');
  it('cancelada nunca; no iniciada; en curso; PAST por ETL; SCHEDULED solo con fin acreditado ya vencido', async () => {
    const at = (iso: string) => new Date(iso);
    assert.deepEqual(
      await assessAppointmentFinished(
        makeReservation({ status: 'CANCELLED' }),
        at('2027-01-01Z'),
        end,
      ),
      { finished: false, code: 'RESERVATION_CANCELLED' },
    );
    assert.deepEqual(
      await assessAppointmentFinished(makeReservation(), at('2026-11-12T19:59:59Z'), end),
      { finished: false, code: 'APPOINTMENT_NOT_STARTED' },
    );
    assert.deepEqual(
      await assessAppointmentFinished(makeReservation(), at('2026-11-12T20:39:59Z'), end),
      { finished: false, code: 'APPOINTMENT_IN_PROGRESS' },
    );
    assert.deepEqual(
      await assessAppointmentFinished(makeReservation(), at('2026-11-12T20:40:00Z'), end),
      { finished: true, sourceStatus: 'SCHEDULED' },
    );
    assert.deepEqual(
      await assessAppointmentFinished(makeReservation(), at('2026-11-13Z'), async () => null),
      { finished: false, code: 'APPOINTMENT_END_UNKNOWN' },
    );
    let loads = 0;
    const counted = async () => {
      loads += 1;
      return null;
    };
    assert.deepEqual(
      await assessAppointmentFinished(
        makeReservation({ status: 'PAST' }),
        at('2026-11-13Z'),
        counted,
      ),
      { finished: true, sourceStatus: 'PAST' },
    );
    assert.equal(loads, 0, 'PAST no consulta la fuente');
  });
});
