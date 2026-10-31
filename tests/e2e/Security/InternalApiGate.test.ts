import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  AUTH_HEADERS,
  buildTestApp,
  TEST_INTERNAL_API_KEY,
  type TestAppContext,
} from '../../helpers/BuildTestApp.js';
import {
  makeReservation,
  SYNTHETIC_RESERVATION_ID,
} from '../../helpers/MakeSyntheticReservation.js';

let ctx: TestAppContext;
afterEach(async () => ctx?.app.close());

const businessRoutes: Array<[string, string]> = [
  ['GET', '/api/v1/reservations?from=2026-11-01&to=2026-11-30'],
  ['GET', `/api/v1/reservations/${SYNTHETIC_RESERVATION_ID}`],
  ['GET', `/api/v1/reservations/${SYNTHETIC_RESERVATION_ID}/risk`],
  ['POST', `/api/v1/reservations/${SYNTHETIC_RESERVATION_ID}/predictions`],
  ['GET', `/api/v1/reservations/${SYNTHETIC_RESERVATION_ID}/risk/factors`],
  ['GET', `/api/v1/reservations/${SYNTHETIC_RESERVATION_ID}/client-history`],
  ['GET', '/api/v1/ml/models'],
];

describe('Compuerta provisional Sprint 01 (no es login HU-21 ni RBAC HU-22)', () => {
  it('todas las rutas de negocio exigen credencial interna ⇒ 401 uniforme', async () => {
    ctx = buildTestApp();
    for (const [method, url] of businessRoutes) {
      for (const headers of [
        {},
        { 'x-api-key': 'wrong-key-wrong-key-wrong-key-wrong-key' },
        { 'x-api-key': TEST_INTERNAL_API_KEY.slice(0, 31) },
      ]) {
        const response = await ctx.app.inject({ method: method as 'GET', url, headers });
        assert.equal(response.statusCode, 401, `${method} ${url}`);
        assert.equal(response.json().error.code, 'UNAUTHORIZED');
      }
    }
    assert.equal(ctx.ml.calls.length, 0);
  });

  it('401 antes de validar parámetros o cuerpo: no revela existencia ni formato de recursos', async () => {
    ctx = buildTestApp();
    const invalidId = await ctx.app.inject({ method: 'GET', url: '/api/v1/reservations/abc/risk' });
    assert.equal(invalidId.statusCode, 401);
    const missing = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/reservations/123456/risk',
    });
    assert.deepEqual(
      [missing.statusCode, missing.json().error.message],
      [401, invalidId.json().error.message],
    );
  });

  it('health existentes siguen abiertos y con su ruta original', async () => {
    ctx = buildTestApp();
    const postgres = await ctx.app.inject({ method: 'GET', url: '/api/health/postgres' });
    assert.deepEqual(postgres.json(), {
      database: 'postgres',
      status: 'ok',
      message: 'Conexión a PostgreSQL verificada',
    });
    assert.equal(
      (await ctx.app.inject({ method: 'GET', url: '/api/health/mysql' })).json().status,
      'disabled',
    );
    assert.equal(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/health/ml' })).statusCode,
      200,
    );
  });

  it('sin credencial configurada las rutas de negocio no existen (404), health intacto', async () => {
    ctx = buildTestApp({ predictiveApi: false });
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/reservations?from=2026-11-01&to=2026-11-02',
      headers: AUTH_HEADERS,
    });
    assert.equal(response.statusCode, 404);
    assert.equal(
      (await ctx.app.inject({ method: 'GET', url: '/api/health/postgres' })).statusCode,
      200,
    );
  });

  it('cabecera de credencial duplicada se rechaza (no se elige un valor arbitrario)', async () => {
    ctx = buildTestApp();
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/ml/models',
      headers: { 'x-api-key': [TEST_INTERNAL_API_KEY, TEST_INTERNAL_API_KEY] as unknown as string },
    });
    assert.equal(response.statusCode, 401);
  });

  it('X-Request-ID opaco se reutiliza; uno inválido se reemplaza; siempre se devuelve', async () => {
    ctx = buildTestApp();
    const ok = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/ml/models',
      headers: { ...AUTH_HEADERS, 'x-request-id': 'next.req-42' },
    });
    assert.equal(ok.headers['x-request-id'], 'next.req-42');
    assert.equal(ok.json().requestId, 'next.req-42');
    assert.equal(ctx.ml.callsOf('models')[0]!.context.requestId, 'next.req-42');
    const forged = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/ml/models',
      headers: { ...AUTH_HEADERS, 'x-request-id': '<script>' },
    });
    assert.match(String(forged.headers['x-request-id']), /^[0-9a-f-]{36}$/);
  });

  it('cuerpo enorme ⇒ 413 antes de deserializar; sin CORS permisivo', async () => {
    ctx = buildTestApp();
    ctx.reservations.add(makeReservation());
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/reservations/${SYNTHETIC_RESERVATION_ID}/predictions`,
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
        origin: 'https://evil.example',
      },
      payload: JSON.stringify({ mode: 'compare', padding: 'x'.repeat(5000) }),
    });
    assert.equal(response.statusCode, 413);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  });

  it('respuestas y logs no contienen la credencial interna ni stacktraces', async () => {
    ctx = buildTestApp();
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/reservations/1',
      headers: AUTH_HEADERS,
    });
    assert.equal(response.statusCode, 404);
    const everything = `${response.body}\n${ctx.logLines.join('\n')}`;
    assert.doesNotMatch(everything, new RegExp(TEST_INTERNAL_API_KEY));
    assert.doesNotMatch(response.body, /at .*\.ts:\d+|stack/i);
  });
});
