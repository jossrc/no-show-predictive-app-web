import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InvalidReservationQueryException } from '../../../../../../src/modules/Reservations/Shared/errors/InvalidReservationQueryException.js';
import {
  decodeReservationCursor,
  encodeReservationCursor,
} from '../../../../../../src/modules/Reservations/Shared/pagination/ReservationCursor.js';

describe('ReservationCursor (keyset opaco ligado a la consulta)', () => {
  it('ida y vuelta conserva probabilidad exacta, null y BIGINT', () => {
    const position = {
      probability: 0.6976400433344135,
      appointmentAt: new Date('2026-11-12T20:00:00Z'),
      reservationId: '9007199254740993',
    };
    assert.deepEqual(
      decodeReservationCursor(encodeReservationCursor(position, 'sig'), 'sig'),
      position,
    );
    const nullPosition = { ...position, probability: null };
    assert.deepEqual(
      decodeReservationCursor(encodeReservationCursor(nullPosition, 'sig'), 'sig'),
      nullPosition,
    );
  });

  it('rechaza cursor de otra consulta, manipulado, con probabilidad fuera de rango o basura', () => {
    const cursor = encodeReservationCursor(
      { probability: undefined, appointmentAt: new Date(), reservationId: '1' },
      'a',
    );
    const forged = Buffer.from(
      JSON.stringify({ v: 1, s: 'a', a: new Date().toISOString(), r: '1', p: 7 }),
    ).toString('base64url');
    const injected = Buffer.from(
      JSON.stringify({ v: 1, s: 'a', a: new Date().toISOString(), r: '1; DROP TABLE x' }),
    ).toString('base64url');
    for (const raw of [
      cursor.replace(/.$/, ''),
      'not base64!',
      'x'.repeat(600),
      forged,
      injected,
    ]) {
      assert.throws(
        () => decodeReservationCursor(raw, 'a'),
        InvalidReservationQueryException,
        raw.slice(0, 20),
      );
    }
    assert.throws(() => decodeReservationCursor(cursor, 'b'), InvalidReservationQueryException);
  });
});
