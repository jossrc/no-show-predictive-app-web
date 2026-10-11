import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { AUTH_HEADERS, buildTestApp, type TestAppContext } from '../../helpers/BuildTestApp.js';
import {
  makeReservation,
  SYNTHETIC_CLIENT_ID,
  SYNTHETIC_RESERVATION_ID,
} from '../../helpers/MakeSyntheticReservation.js';

let ctx: TestAppContext;
afterEach(async () => ctx?.app.close());

const history = (id: string, query = '') =>
  ctx.app.inject({
    method: 'GET',
    url: `/api/v1/reservations/${id}/client-history${query}`,
    headers: AUTH_HEADERS,
  });

describe('HU-06: GET /client-history', () => {
  it('cliente sin historia ⇒ 200 con ceros; corte as-of de la reserva por defecto', async () => {
    ctx = buildTestApp();
    ctx.reservations.add(makeReservation());
    const response = await history(SYNTHETIC_RESERVATION_ID);
    assert.equal(response.statusCode, 200);
    const data = response.json().data;
    assert.deepEqual(
      [
        data.historicalAsOf,
        data.previousNoShow,
        data.previousAttended,
        data.noShowRate,
        data.lastNoShowAt,
      ],
      ['booking_creation', 0, 0, null, null],
    );
    assert.equal(data.cutoffSemantics, 'known_at < cutoffAt');
    assert.equal(data.clientId, SYNTHETIC_CLIENT_ID);
  });

  it('aislamiento: dos reservas de clientes distintos nunca comparten historial; no acepta clientId', async () => {
    ctx = buildTestApp();
    const otherReservation = '900000000001999';
    ctx.reservations.add(
      makeReservation(),
      makeReservation({ reservationId: otherReservation, clientId: '900000000002999' }),
    );
    ctx.history.add(
      {
        clientId: SYNTHETIC_CLIENT_ID,
        appointmentId: '1',
        knownAt: new Date('2026-06-01Z'),
        kind: 1,
      },
      {
        clientId: '900000000002999',
        appointmentId: '2',
        knownAt: new Date('2026-06-01Z'),
        kind: 0,
      },
    );
    assert.equal((await history(SYNTHETIC_RESERVATION_ID)).json().data.previousNoShow, 1);
    const other = (await history(otherReservation)).json().data;
    assert.deepEqual([other.previousNoShow, other.previousAttended], [0, 1]);
    assert.equal(
      (await history(SYNTHETIC_RESERVATION_ID, '?clientId=900000000002999')).statusCode,
      400,
    );
    assert.equal(
      (await history(SYNTHETIC_RESERVATION_ID, '?historicalAsOf=yesterday')).statusCode,
      400,
    );
    assert.equal((await history('77')).statusCode, 404);
  });
});
