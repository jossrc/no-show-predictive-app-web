import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { SourceDataUnavailableException } from '../../../src/infrastructure/database/errors/SourceDataUnavailableException.js';
import { AUTH_HEADERS, buildTestApp, type TestAppContext } from '../../helpers/BuildTestApp.js';
import { FakeRiskPolicy } from '../../helpers/FakeRiskPolicy.js';
import { makeReservation } from '../../helpers/MakeSyntheticReservation.js';

let ctx: TestAppContext;
afterEach(async () => ctx?.app.close());

const list = (query: string) =>
  ctx.app.inject({ method: 'GET', url: `/api/v1/reservations?${query}`, headers: AUTH_HEADERS });

function seed(count: number): string[] {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = String(900000000005000 + index);
    ids.push(id);
    ctx.reservations.add(
      makeReservation({
        reservationId: id,
        clinicId: index % 2 === 0 ? 1 : 2,
        appointmentAt: new Date(Date.UTC(2026, 10, 2 + (index % 20), 14, 0, 0)),
      }),
    );
  }
  return ids;
}

describe('GET /api/v1/reservations (HU-01/HU-03)', () => {
  it('lista paginada (25 por defecto) con riesgo null, política pendiente y motivos NOT_SCORABLE', async () => {
    ctx = buildTestApp();
    seed(30);
    const response = await list('from=2026-11-01&to=2026-11-30');
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.data.length, 25);
    assert.ok(body.pagination.nextCursor);
    assert.equal(body.classificationUnavailable, true);
    assert.equal(body.sourceStatus, 'READ_ONLY_EXISTING_SCHEDULE');
    const item = body.data[0];
    assert.equal(item.risk.riskLevel, null);
    assert.equal(item.risk.predictionAvailability, 'NOT_SCORABLE');
    assert.deepEqual(item.risk.probabilities, []);
    assert.ok(
      item.risk.notScorableReasons.some(
        (r: { code: string }) => r.code === 'SCHEDULED_SERVICES_NOT_POINT_IN_TIME',
      ),
    );
    assert.doesNotMatch(
      response.body,
      /"riskLevel":"(LOW|MEDIUM|HIGH)"/,
      'nunca LOW/MEDIUM/HIGH implícito',
    );
    assert.equal(ctx.ml.calls.length, 0, 'el listado no llama a Python (sin N+1)');

    const next = await list(`from=2026-11-01&to=2026-11-30&cursor=${body.pagination.nextCursor}`);
    assert.equal(next.json().data.length, 5);
    assert.equal(next.json().pagination.nextCursor, null);
    const seen = new Set(
      [...body.data, ...next.json().data].map((d: { reservationId: string }) => d.reservationId),
    );
    assert.equal(seen.size, 30);
  });

  it('período sin citas ⇒ 200 vacío; filtro por sede; límites de paginación', async () => {
    ctx = buildTestApp();
    seed(6);
    assert.deepEqual((await list('from=2027-01-01&to=2027-01-02')).json().data, []);
    const clinic2 = (await list('from=2026-11-01&to=2026-11-30&clinicId=2')).json().data;
    assert.ok(clinic2.length > 0 && clinic2.every((d: { clinicId: number }) => d.clinicId === 2));
    assert.equal((await list('from=2026-11-01&to=2026-11-30&limit=100')).statusCode, 200);
    assert.equal((await list('from=2026-11-01&to=2026-11-30&limit=101')).statusCode, 400);
    assert.equal((await list('from=2026-11-01&to=2026-11-30&limit=0')).statusCode, 400);
  });

  it('validación estricta: fechas, campos extra, inyección en sort/modelKey/clinicId ⇒ 400', async () => {
    ctx = buildTestApp();
    const bad = [
      'from=2026-02-30&to=2026-03-01',
      'from=2026-11-01',
      'from=2026-11-01&to=2026-11-30&sort=appointment_at;DROP TABLE x',
      "from=2026-11-01&to=2026-11-30&modelKey=random_forest_full_v1'--",
      'from=2026-11-01&to=2026-11-30&clinicId=1abc',
      'from=2026-11-01&to=2026-11-30&clinicId=0',
      'from=2026-11-01&to=2026-11-30&orderBy=client_id',
      'from=2026-11-01&to=2026-11-30&direction=sideways',
      'from=2026-11-01&to=2026-11-30&status=DRAFT',
    ];
    for (const query of bad) {
      assert.equal((await list(query)).statusCode, 400, query);
    }
    assert.equal(ctx.reservations.listCalls, 0);
  });

  it('rango invertido, >92 días o sede inexistente ⇒ 422 con código estable', async () => {
    ctx = buildTestApp();
    assert.equal((await list('from=2026-11-30&to=2026-11-01')).json().error.code, 'INVALID_PERIOD');
    assert.equal((await list('from=2026-01-01&to=2026-12-31')).statusCode, 422);
    const unknownClinic = await list('from=2026-11-01&to=2026-11-30&clinicId=99');
    assert.deepEqual(
      [unknownClinic.statusCode, unknownClinic.json().error.code],
      [422, 'UNKNOWN_CLINIC'],
    );
  });

  it('riskLevel o sort=riskLevel sin política aprobada ⇒ 409 RISK_POLICY_UNAVAILABLE', async () => {
    ctx = buildTestApp();
    seed(3);
    for (const query of ['riskLevel=HIGH', 'sort=riskLevel']) {
      const response = await list(`from=2026-11-01&to=2026-11-30&${query}`);
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().error.code, 'RISK_POLICY_UNAVAILABLE');
      assert.equal(response.json().error.message, 'Niveles de riesgo pendientes de validación');
    }
  });

  it('con política SINTÉTICA de prueba el filtro por nivel funciona (no habilitable en runtime)', async () => {
    ctx = buildTestApp({ policy: new FakeRiskPolicy() });
    seed(2);
    const response = await list('from=2026-11-01&to=2026-11-30&riskLevel=LOW');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().data, [], 'sin scores persistidos no hay nivel');
    assert.equal(response.json().classificationUnavailable, false);
  });

  it('fuente de datos caída ⇒ 503 seguro, sin SQL ni datos inventados', async () => {
    ctx = buildTestApp();
    ctx.reservations.failWith = new SourceDataUnavailableException({
      operation: 'List',
      cause: new Error('connect ECONNREFUSED 10.0.0.1:5432 password=secret'),
    });
    const response = await list('from=2026-11-01&to=2026-11-30');
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'SOURCE_DATA_UNAVAILABLE');
    assert.doesNotMatch(response.body, /ECONNREFUSED|password|5432/);
  });
});
