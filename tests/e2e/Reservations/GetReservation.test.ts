import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { AUTH_HEADERS, buildTestApp, type TestAppContext } from '../../helpers/BuildTestApp.js';
import { makeReservation, UNSAFE_BIGINT_ID } from '../../helpers/MakeSyntheticReservation.js';

let ctx: TestAppContext;
afterEach(async () => ctx?.app.close());

describe('GET /api/v1/reservations/:reservationId', () => {
  it('detalle factual con BIGINT como string sin redondeo y sin PII adicional', async () => {
    ctx = buildTestApp();
    ctx.reservations.add(makeReservation({ reservationId: UNSAFE_BIGINT_ID }));
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/reservations/${UNSAFE_BIGINT_ID}`,
      headers: AUTH_HEADERS,
    });
    assert.equal(response.statusCode, 200);
    const data = response.json().data;
    assert.equal(data.reservationId, '9007199254740993');
    assert.equal(data.reservationStatus, 'SCHEDULED');
    assert.deepEqual(data.scores, []);
    for (const pii of ['name', 'clientName', 'birthDate', 'sex', 'phone', 'email']) {
      assert.ok(!(pii in data), pii);
    }
  });

  it('IDs mal formados ⇒ 400 (sin parseInt parcial); inexistente ⇒ 404', async () => {
    ctx = buildTestApp();
    for (const id of ['123abc', '0123', '-1', '1.5', '1'.repeat(19), '1e5']) {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/reservations/${id}`,
        headers: AUTH_HEADERS,
      });
      assert.equal(response.statusCode, 400, id);
      assert.equal(response.json().error.code, 'REQUEST_VALIDATION_ERROR');
    }
    const missing = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/reservations/42',
      headers: AUTH_HEADERS,
    });
    assert.deepEqual(
      [missing.statusCode, missing.json().error.code],
      [404, 'RESERVATION_NOT_FOUND'],
    );
  });
});
