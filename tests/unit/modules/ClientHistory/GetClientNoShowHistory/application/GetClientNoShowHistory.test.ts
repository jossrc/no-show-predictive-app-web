import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GetClientNoShowHistory } from '../../../../../../src/modules/ClientHistory/GetClientNoShowHistory/application/GetClientNoShowHistory.js';
import { HistoryCutoffUnavailableException } from '../../../../../../src/modules/ClientHistory/Shared/errors/HistoryCutoffUnavailableException.js';
import { ReservationNotFoundException } from '../../../../../../src/modules/Reservations/Shared/errors/ReservationNotFoundException.js';
import { FixedClock } from '../../../../../helpers/FixedClock.js';
import { InMemoryClientHistoryRepository } from '../../../../../helpers/InMemoryClientHistoryRepository.js';
import { InMemoryPredictiveStore } from '../../../../../helpers/InMemoryPredictiveStore.js';
import { InMemoryReservationRepository } from '../../../../../helpers/InMemoryReservationRepository.js';
import {
  makeReservation,
  SYNTHETIC_CLIENT_ID,
  SYNTHETIC_RESERVATION_ID,
  UNSAFE_BIGINT_ID,
} from '../../../../../helpers/MakeSyntheticReservation.js';

function setup() {
  const reservations = new InMemoryReservationRepository(new InMemoryPredictiveStore());
  const history = new InMemoryClientHistoryRepository();
  const clock = new FixedClock(new Date('2026-12-01T00:00:00Z'));
  reservations.add(makeReservation());
  const useCase = new GetClientNoShowHistory({ reservations, history, clock });
  const run = (
    historicalAsOf: 'booking_creation' | 'current_known' = 'booking_creation',
    reservationId = SYNTHETIC_RESERVATION_ID,
  ) => useCase.execute({ reservationId, historicalAsOf, clinicScope: { kind: 'ALL_CLINICS' } });
  return { reservations, history, clock, run };
}

describe('GetClientNoShowHistory (HU-06)', () => {
  it('cliente sin historia ⇒ 200 con ceros y tasa/fechas null', async () => {
    const result = await setup().run();
    assert.deepEqual(
      [
        result.previousAttended,
        result.previousNoShow,
        result.resolvedTotal,
        result.noShowRate,
        result.lastNoShowAt,
      ],
      [0, 0, 0, null, null],
    );
    assert.equal(result.historySemantics, 'NO_SHOW_CANDIDATE');
    assert.ok(result.warnings.includes('CANCELLATIONS_EXCLUDED'));
  });

  it('booking_creation usa el corte de la reserva; current_known incluye lo conocido hasta hoy', async () => {
    const ctx = setup();
    ctx.history.add(
      {
        clientId: SYNTHETIC_CLIENT_ID,
        appointmentId: '1',
        knownAt: new Date('2026-05-01Z'),
        kind: 1,
      },
      {
        clientId: SYNTHETIC_CLIENT_ID,
        appointmentId: '2',
        knownAt: new Date('2026-11-20Z'),
        kind: 1,
      },
      {
        clientId: '900000000002999',
        appointmentId: '3',
        knownAt: new Date('2026-05-02Z'),
        kind: 1,
      },
    );
    const asOfBooking = await ctx.run('booking_creation');
    assert.equal(asOfBooking.cutoffAt.toISOString(), '2026-10-20T16:00:00.000Z');
    assert.deepEqual([asOfBooking.previousNoShow, asOfBooking.noShowRate], [1, 1]);
    const current = await ctx.run('current_known');
    assert.equal(current.previousNoShow, 2);
    assert.ok(current.warnings.includes('CURRENT_KNOWN_DOES_NOT_FEED_ORIGINAL_SCORE'));
    assert.equal(current.lastNoShowAt?.toISOString(), '2026-11-20T00:00:00.000Z');
  });

  it('el cliente se deriva de la reserva (BIGINT como string sin pérdida)', async () => {
    const ctx = setup();
    ctx.reservations.add(
      makeReservation({ reservationId: UNSAFE_BIGINT_ID, clientId: UNSAFE_BIGINT_ID }),
    );
    const result = await ctx.run('booking_creation', UNSAFE_BIGINT_ID);
    assert.equal(result.clientId, '9007199254740993');
  });

  it('reserva inexistente ⇒ 404; sin creación ⇒ corte booking_creation no disponible', async () => {
    const ctx = setup();
    await assert.rejects(ctx.run('booking_creation', '1'), ReservationNotFoundException);
    ctx.reservations.add(makeReservation({ bookingCreatedAt: null }));
    await assert.rejects(ctx.run('booking_creation'), HistoryCutoffUnavailableException);
    assert.equal((await ctx.run('current_known')).previousNoShow, 0);
  });
});
