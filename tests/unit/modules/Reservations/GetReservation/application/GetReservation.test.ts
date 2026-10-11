import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GetReservation } from '../../../../../../src/modules/Reservations/GetReservation/application/GetReservation.js';
import { ReservationNotFoundException } from '../../../../../../src/modules/Reservations/Shared/errors/ReservationNotFoundException.js';
import { FixedClock } from '../../../../../helpers/FixedClock.js';
import { InMemoryPredictiveStore } from '../../../../../helpers/InMemoryPredictiveStore.js';
import { InMemoryReservationRepository } from '../../../../../helpers/InMemoryReservationRepository.js';
import {
  makeReservation,
  makeStoredSnapshot,
  SYNTHETIC_RESERVATION_ID,
} from '../../../../../helpers/MakeSyntheticReservation.js';

describe('GetReservation', () => {
  it('detalle factual + snapshot disponible según evidencia del modo activo', async () => {
    const store = new InMemoryPredictiveStore();
    const reservations = new InMemoryReservationRepository(store);
    reservations.add(makeReservation());
    store.addSnapshot(makeStoredSnapshot({ evidenceSource: 'SYNTHETIC_DEMO_ONLY' }));
    const clock = new FixedClock(new Date('2026-10-25Z'));

    const readOnly = await new GetReservation(
      reservations,
      clock,
      'READ_ONLY_EXISTING_SCHEDULE',
    ).execute({
      reservationId: SYNTHETIC_RESERVATION_ID,
      clinicScope: { kind: 'ALL_CLINICS' },
    });
    assert.equal(
      readOnly.hasUsableSnapshot,
      false,
      'un snapshot sintético nunca vale en modo real',
    );
    const synthetic = await new GetReservation(reservations, clock, 'SYNTHETIC_DEMO_ONLY').execute({
      reservationId: SYNTHETIC_RESERVATION_ID,
      clinicScope: { kind: 'ALL_CLINICS' },
    });
    assert.equal(synthetic.hasUsableSnapshot, true);
    assert.equal(synthetic.sourceStatus, 'SYNTHETIC_DEMO_ONLY');

    await assert.rejects(
      new GetReservation(reservations, clock, 'READ_ONLY_EXISTING_SCHEDULE').execute({
        reservationId: '5',
        clinicScope: { kind: 'ALL_CLINICS' },
      }),
      ReservationNotFoundException,
    );
  });
});
