import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { preAssessScorability } from '../../../../../../src/modules/ReservationRisk/Shared/validation/PreAssessScorability.js';
import { makeReservation } from '../../../../../helpers/MakeSyntheticReservation.js';

const readOnly = {
  mode: 'READ_ONLY_EXISTING_SCHEDULE' as const,
  snapshotEvidenceSource: 'VERIFIED_BOOKING_SNAPSHOT' as const,
};

describe('PreAssessScorability (estado por fila del listado, sin consultas extra)', () => {
  it('creación en/después de la cita ⇒ BOOKING_NOT_BEFORE_APPOINTMENT', () => {
    const reservation = makeReservation();
    const result = preAssessScorability(
      { ...reservation, bookingCreatedAt: reservation.appointmentAt },
      { hasScores: false, hasUsableSnapshot: false },
      readOnly,
    );
    assert.equal(result.availability, 'NOT_SCORABLE');
    assert.deepEqual(
      result.reasons.map((r) => r.code),
      ['BOOKING_NOT_BEFORE_APPOINTMENT'],
    );
  });
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

  it('hechos incompatibles ⇒ NOT_SCORABLE con motivos tipados', () => {
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
      ],
    );
  });

  it('sin evaluación completa ⇒ NOT_SCORED preliminar; fuente de otro modo se rechaza', () => {
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
      readOnly,
    );
    assert.equal(captured.availability, 'NOT_SCORED');

    // Proveedor sintético local (fixtures con captura sintética) en su propio modo ⇒ evaluable.
    const syntheticSource = preAssessScorability(
      makeReservation(),
      { hasScores: false, hasUsableSnapshot: false },
      {
        mode: 'SYNTHETIC_DEMO_ONLY',
        snapshotEvidenceSource: 'SYNTHETIC_DEMO_ONLY',
      },
    );
    assert.equal(syntheticSource.availability, 'NOT_SCORED');

    // Fuente sintética en modo real: nunca se mezcla.
    const mixed = preAssessScorability(
      makeReservation(),
      { hasScores: false, hasUsableSnapshot: false },
      {
        ...readOnly,
        snapshotEvidenceSource: 'SYNTHETIC_DEMO_ONLY',
      },
    );
    assert.deepEqual(
      mixed.reasons.map((r) => r.code),
      ['NO_USABLE_SNAPSHOT_IN_MODE'],
    );
  });
});
