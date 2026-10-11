import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveReservationStatus } from '../../../../../../src/modules/Reservations/Shared/models/ReservationStatus.js';

describe('deriveReservationStatus (semántica FLOW_NO_SHOW_V1 auditada)', () => {
  it('FUTURE ⇒ SCHEDULED; FUTURE_CANCELLED ⇒ CANCELLED; resultados pasados ⇒ PAST', () => {
    assert.equal(deriveReservationStatus('FUTURE', 'FUTURE_PENDING'), 'SCHEDULED');
    assert.equal(deriveReservationStatus('CANCELLED', 'FUTURE_CANCELLED'), 'CANCELLED');
    for (const outcome of [
      'ATTENDED_COMPLETED',
      'NO_SHOW',
      'CANCELLED',
      'IN_PROGRESS',
      'UNKNOWN',
    ]) {
      assert.equal(deriveReservationStatus(outcome, 'CANCELLED_OR_UNCLASSIFIED'), 'PAST', outcome);
    }
  });

  it('borradores (tag 16), copias de reprogramación, bloqueos e ignorados NO son reservas', () => {
    for (const outcome of ['DRAFT', 'RESCHEDULED_HISTORY', 'BLOCKED', 'IGNORED']) {
      assert.equal(deriveReservationStatus(outcome, 'EXCLUDED'), null, outcome);
    }
  });
});
