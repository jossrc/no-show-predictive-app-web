import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { preAssessScorability } from '../../../../../../src/modules/ReservationRisk/Shared/validation/PreAssessScorability.js';
import { makeReservation } from '../../../../../helpers/MakeSyntheticReservation.js';

const readOnly = {
  mode: 'READ_ONLY_EXISTING_SCHEDULE' as const,
  servicesTemporalEvidence: 'NONE_CURRENT_REPLICA' as const,
};

describe('PreAssessScorability (estado por fila del listado, sin consultas extra)', () => {
  it('scores persistidos ⇒ AVAILABLE_EXPLORATORY; snapshot sin score ⇒ NOT_SCORED', () => {
    assert.equal(
      preAssessScorability(
        makeReservation(),
        { hasScores: true, hasUsableSnapshot: true },
        readOnly,
      ).availability,
      'AVAILABLE_EXPLORATORY',
    );
    assert.equal(
      preAssessScorability(
        makeReservation(),
        { hasScores: false, hasUsableSnapshot: true },
        readOnly,
      ).availability,
      'NOT_SCORED',
    );
  });

  it('réplica sin evidencia temporal ⇒ NOT_SCORABLE con motivos tipados (nunca score 0)', () => {
    const result = preAssessScorability(
      makeReservation({ bookingCreatedAt: null, hasRescheduleEvent: true, status: 'CANCELLED' }),
      { hasScores: false, hasUsableSnapshot: false },
      readOnly,
    );
    assert.equal(result.availability, 'NOT_SCORABLE');
    assert.deepEqual(
      result.reasons.map((r) => r.code),
      [
        'RESERVATION_NOT_SCHEDULED',
        'MISSING_BOOKING_TIME',
        'RESCHEDULED_WITHOUT_ORIGINAL_SNAPSHOT',
        'SCHEDULED_SERVICES_NOT_POINT_IN_TIME',
      ],
    );
  });

  it('modo sintético sin snapshot ⇒ NO_USABLE_SNAPSHOT_IN_MODE; captura fechada ⇒ NOT_SCORED', () => {
    const synthetic = preAssessScorability(
      makeReservation(),
      { hasScores: false, hasUsableSnapshot: false },
      { ...readOnly, mode: 'SYNTHETIC_DEMO_ONLY' },
    );
    assert.deepEqual(
      synthetic.reasons.map((r) => r.code),
      ['NO_USABLE_SNAPSHOT_IN_MODE'],
    );
    const captured = preAssessScorability(
      makeReservation(),
      { hasScores: false, hasUsableSnapshot: false },
      { ...readOnly, servicesTemporalEvidence: 'CAPTURED_AT_BOOKING' },
    );
    assert.equal(captured.availability, 'NOT_SCORED');
  });
});
