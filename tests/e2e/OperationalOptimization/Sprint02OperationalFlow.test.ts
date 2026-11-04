import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { LightMyRequestResponse } from 'fastify';
import { PersistenceUnavailableException } from '../../../src/infrastructure/database/errors/PersistenceUnavailableException.js';
import { AUTH_HEADERS, buildTestApp, type TestAppContext } from '../../helpers/BuildTestApp.js';
import { FakeBookingEvidenceSource } from '../../helpers/FakeBookingEvidenceSource.js';
import {
  makeBookingEvidence,
  makeReservation,
  SYNTHETIC_RESERVATION_ID as ID,
} from '../../helpers/MakeSyntheticReservation.js';

/**
 * E2E HTTP Sprint 02 (HU-06/07/08) con la app Fastify completa (rutas, schemas, compuerta,
 * error handler) y dobles en memoria con las reglas UNIQUE/inmutabilidad de PostgreSQL. La
 * integración tests/integration/e2e/Sprint02DatabaseFlow repite el flujo sobre PostgreSQL real.
 */
const OTHER = '900000000001099';
const NOVEMBER = 'from=2026-11-01&to=2026-11-30';
const AFTER_APPOINTMENT = new Date('2026-11-12T21:00:00.000Z');
const DURING_APPOINTMENT = new Date('2026-11-12T20:10:00.000Z');

let ctx: TestAppContext;
afterEach(async () => ctx?.app.close());

function scenario(): TestAppContext {
  const context = buildTestApp({
    research: true,
    evidence: new FakeBookingEvidenceSource('CAPTURED_AT_BOOKING'),
  });
  context.reservations.add(makeReservation());
  context.evidence.add(makeBookingEvidence());
  return context;
}

const get = (url: string): Promise<LightMyRequestResponse> =>
  ctx.app.inject({ method: 'GET', url, headers: AUTH_HEADERS });
const post = (url: string, payload: unknown): Promise<LightMyRequestResponse> =>
  ctx.app.inject({ method: 'POST', url, headers: AUTH_HEADERS, payload: payload as object });

async function predict(id = ID): Promise<{ rf: string; xgb: string }> {
  const response = await post(`/api/v1/reservations/${id}/predictions`, { mode: 'compare' });
  assert.ok([200, 201].includes(response.statusCode), response.body);
  const models = response.json().data.models as Array<{
    modelKey: string;
    predictionRunId: string;
  }>;
  return {
    rf: models.find((m) => m.modelKey === 'random_forest_full_v1')!.predictionRunId,
    xgb: models.find((m) => m.modelKey === 'xgboost_full_v1')!.predictionRunId,
  };
}

const enable = (body: unknown, id = ID) =>
  post(`/api/v1/reservations/${id}/overbooking-authorizations`, body);
const recordAttendance = (body: unknown, id = ID) =>
  post(`/api/v1/reservations/${id}/attendance-outcomes`, body);
const recordRecovery = (body: unknown, id = ID) =>
  post(`/api/v1/reservations/${id}/space-recovery-outcomes`, body);

describe('Sprint 02 E2E: HU-06 → HU-07 → HU-08 sobre la API real (dobles en memoria)', () => {
  it('flujo completo: HIGH ⇒ habilitar ⇒ detalle/lista ⇒ cita finaliza ⇒ asistencia ⇒ recuperación', async () => {
    ctx = scenario();

    // HU-06 CA1: antes de predecir no es elegible (NOT_SCORED) y la API lo dice explícitamente.
    const before = (await get(`/api/v1/reservations/${ID}/overbooking-authorization`)).json().data;
    assert.deepEqual(
      [before.enabled, before.status, before.authorization],
      [false, 'NOT_ENABLED', null],
    );
    assert.equal(before.eligibility.eligible, false);
    assert.deepEqual(
      before.eligibility.reasons.map((r: { code: string }) => r.code),
      ['NOT_SCORED'],
    );

    const runs = await predict();
    assert.equal(runs.rf, runs.xgb, 'compare ⇒ un run con ambos modelos');
    const eligibility = (await get(`/api/v1/reservations/${ID}/overbooking-authorization`)).json()
      .data.eligibility;
    assert.equal(eligibility.eligible, true);
    assert.equal(eligibility.ruleVersion, 'overbooking_eligibility_v1');
    assert.deepEqual(
      eligibility.candidates.map(
        (c: { modelKey: string; experimentalRiskLevel: string; eligible: boolean }) => [
          c.modelKey,
          c.experimentalRiskLevel,
          c.eligible,
        ],
      ),
      [
        ['random_forest_full_v1', 'HIGH', true],
        ['xgboost_full_v1', 'HIGH', true],
      ],
    );
    const mlCalls = ctx.ml.calls.length;

    // HU-06 CA2/CA4: crea la marca ENABLED; solo INSERT propio, sin tocar reserva ni Python.
    const created = await enable({ modelKey: 'random_forest_full_v1', predictionRunId: runs.rf });
    assert.equal(created.statusCode, 201, created.body);
    const authorization = created.json().data;
    assert.deepEqual(
      [
        authorization.status,
        authorization.statusLabel,
        authorization.enabled,
        authorization.replayed,
      ],
      ['ENABLED', 'Habilitado para sobreasignación', true, false],
    );
    assert.equal(authorization.riskBandAtAuthorization, 'HIGH');
    assert.equal(authorization.probabilityNoShowAtAuthorization, 0.6976400433344135);
    assert.deepEqual(
      [authorization.actorKind, authorization.actorUserId],
      ['INTERNAL_SERVICE', null],
    );
    assert.equal(
      authorization.enabledAt,
      '2026-10-25T15:00:00.000Z',
      'instante del Clock del servidor',
    );
    assert.equal(created.json().requestId, created.headers['x-request-id']);
    assert.equal(ctx.ml.calls.length, mlCalls, 'HU-06 no llama a Python');
    assert.equal(
      ctx.reservations.reservations.get(ID)?.status,
      'SCHEDULED',
      'reserva fuente intacta',
    );

    // Reintento idéntico ⇒ 200 sin duplicar; otra predicción ⇒ 409 sin reemplazar.
    const replay = await enable({ modelKey: 'random_forest_full_v1', predictionRunId: runs.rf });
    assert.deepEqual([replay.statusCode, replay.json().data.replayed], [200, true]);
    const conflict = await enable({ modelKey: 'xgboost_full_v1', predictionRunId: runs.xgb });
    assert.deepEqual(
      [conflict.statusCode, conflict.json().error.code],
      [409, 'OVERBOOKING_ALREADY_ENABLED_CONFLICT'],
    );
    assert.equal(ctx.operations.authorizationRows.length, 1);

    // HU-06 CA3: detalle, GET dedicado y listados muestran el estado actualizado.
    const detail = (await get(`/api/v1/reservations/${ID}`)).json().data;
    assert.equal(detail.reservationStatus, 'SCHEDULED', 'estado de la reserva fuente sin cambios');
    assert.deepEqual(
      [detail.overbooking.enabled, detail.overbooking.status, detail.overbooking.authorizationId],
      [true, 'ENABLED', authorization.authorizationId],
    );
    assert.deepEqual(detail.attendanceOutcome, {
      recorded: false,
      attendanceStatus: null,
      recordedAt: null,
    });
    assert.deepEqual(detail.spaceRecoveryOutcome, {
      recorded: false,
      spaceRecovered: null,
      recordedAt: null,
    });
    const row = (await get(`/api/v1/reservations?${NOVEMBER}`)).json().data[0];
    assert.equal(row.overbooking.enabled, true);
    assert.ok('risk' in row && 'probabilities' in row.risk, 'campos de Sprint 01 intactos');
    const listed = (await get(`/api/v1/overbooking-authorizations?${NOVEMBER}`)).json();
    assert.deepEqual(
      listed.data.map((a: { reservationId: string }) => a.reservationId),
      [ID],
    );
    assert.equal(listed.period.timeZone, 'America/Lima');
    assert.equal(listed.pagination.nextCursor, null);
    const state = (await get(`/api/v1/reservations/${ID}/overbooking-authorization`)).json().data;
    assert.deepEqual([state.enabled, state.eligibility.eligible], [true, false]);
    assert.deepEqual(
      state.eligibility.reasons.map((r: { code: string }) => r.code),
      ['ALREADY_ENABLED'],
    );

    // HU-07 CA1: durante o antes de la cita no se registra.
    const early = await recordAttendance({ attendanceStatus: 'NO_SHOW', predictionRunId: runs.rf });
    assert.deepEqual(
      [early.statusCode, early.json().error.code, early.json().error.details.reason],
      [409, 'APPOINTMENT_NOT_FINISHED', 'APPOINTMENT_NOT_STARTED'],
    );
    ctx.clock.set(DURING_APPOINTMENT);
    const during = await recordAttendance({
      attendanceStatus: 'NO_SHOW',
      predictionRunId: runs.rf,
    });
    assert.equal(during.json().error.details.reason, 'APPOINTMENT_IN_PROGRESS');

    ctx.clock.set(AFTER_APPOINTMENT);
    const registration = (await get(`/api/v1/reservations/${ID}/attendance-outcome`)).json().data;
    assert.deepEqual(
      [registration.recorded, registration.attendanceStatus, registration.registration.registrable],
      [false, null, true],
    );
    assert.deepEqual(registration.registration.availablePredictionRunIds, [runs.rf]);

    // HU-07 CA2/CA3/CA4: guarda la observación y compara RF y XGB por separado.
    const recorded = await recordAttendance({
      attendanceStatus: 'NO_SHOW',
      predictionRunId: runs.rf,
    });
    assert.equal(recorded.statusCode, 201, recorded.body);
    const outcome = recorded.json().data;
    assert.deepEqual(
      [outcome.attendanceStatus, outcome.observedNoShow, outcome.replayed],
      ['NO_SHOW', true, false],
    );
    assert.equal(outcome.predictionRunId, runs.rf);
    assert.deepEqual(
      outcome.comparisons.map(
        (c: {
          modelKey: string;
          probabilityNoShow: number;
          predictedNoShow: boolean;
          matchesPrediction: boolean;
          threshold: number;
        }) => [
          c.modelKey,
          c.probabilityNoShow,
          c.predictedNoShow,
          c.matchesPrediction,
          c.threshold,
        ],
      ),
      [
        ['random_forest_full_v1', 0.6976400433344135, true, true, 0.5],
        ['xgboost_full_v1', 0.9159286618232727, true, true, 0.5],
      ],
    );
    assert.match(outcome.comparisonNotice, /no validado/);
    assert.equal(ctx.ml.calls.length, mlCalls, 'HU-07 no recalcula con Python');
    const same = await recordAttendance({ attendanceStatus: 'NO_SHOW', predictionRunId: runs.rf });
    assert.deepEqual([same.statusCode, same.json().data.replayed], [200, true]);
    const contradictory = await recordAttendance({
      attendanceStatus: 'ATTENDED',
      predictionRunId: runs.rf,
    });
    assert.deepEqual(
      [contradictory.statusCode, contradictory.json().error.code],
      [409, 'ATTENDANCE_ALREADY_RECORDED_CONFLICT'],
    );
    const consulted = (await get(`/api/v1/reservations/${ID}/attendance-outcome`)).json().data;
    assert.deepEqual([consulted.recorded, consulted.attendanceStatus], [true, 'NO_SHOW']);
    assert.equal(consulted.registration.blocker, 'ALREADY_RECORDED');
    assert.equal(consulted.outcome.comparisons.length, 2);

    // HU-08 CA1/CA2: con gestión HU-06 previa guarda false (≠ null) y lo devuelve como false.
    const recovery = await recordRecovery({ spaceRecovered: false });
    assert.equal(recovery.statusCode, 201, recovery.body);
    assert.deepEqual(
      [recovery.json().data.spaceRecovered, recovery.json().data.authorizationId],
      [false, authorization.authorizationId],
    );
    const recoveryState = (await get(`/api/v1/reservations/${ID}/space-recovery-outcome`)).json()
      .data;
    assert.deepEqual(
      [
        recoveryState.recorded,
        recoveryState.spaceRecovered,
        recoveryState.preventiveAction.enabled,
      ],
      [true, false, true],
    );
    const flip = await recordRecovery({ spaceRecovered: true });
    assert.deepEqual(
      [flip.statusCode, flip.json().error.code],
      [409, 'SPACE_RECOVERY_ALREADY_RECORDED_CONFLICT'],
    );

    // HU-08 CA4 y HU-07 CA4: datos consultables en listados para reportes futuros.
    const recoveries = (await get(`/api/v1/space-recovery-outcomes?${NOVEMBER}`)).json().data;
    assert.deepEqual(
      recoveries.map((r: { spaceRecovered: boolean }) => r.spaceRecovered),
      [false],
    );
    const outcomes = (await get(`/api/v1/attendance-outcomes?${NOVEMBER}`)).json().data;
    assert.equal(outcomes[0].comparisons.length, 2);

    const finalDetail = (await get(`/api/v1/reservations/${ID}`)).json().data;
    assert.deepEqual(
      [
        finalDetail.overbooking.enabled,
        finalDetail.attendanceOutcome.attendanceStatus,
        finalDetail.spaceRecoveryOutcome.spaceRecovered,
      ],
      [true, 'NO_SHOW', false],
    );
  });

  it('HU-06 rechaza: banda no HIGH, predicción ajena o inexistente, cancelada, pasada, reserva inexistente', async () => {
    ctx = scenario();
    ctx.ml.setProbability('random_forest_full_v1', 0.35); // MEDIUM con los límites publicados
    const runs = await predict();
    const medium = await enable({ modelKey: 'random_forest_full_v1', predictionRunId: runs.rf });
    assert.deepEqual(
      [medium.statusCode, medium.json().error.code],
      [409, 'OVERBOOKING_NOT_ELIGIBLE'],
    );
    assert.deepEqual(
      medium.json().error.details.reasons.map((r: { code: string }) => r.code),
      ['PREDICTION_NOT_HIGH'],
    );
    assert.equal(ctx.operations.inserts, 0, 'cero INSERT');

    // Run de OTRA reserva (o inexistente) ⇒ PREDICTION_RESERVATION_MISMATCH.
    ctx.reservations.add(makeReservation({ reservationId: OTHER }));
    ctx.evidence.add(makeBookingEvidence({ reservationId: OTHER }));
    const otherRuns = await predict(OTHER);
    const foreign = await enable({ modelKey: 'xgboost_full_v1', predictionRunId: otherRuns.xgb });
    assert.deepEqual(
      [foreign.statusCode, foreign.json().error.code],
      [409, 'PREDICTION_RESERVATION_MISMATCH'],
    );
    const unknown = await enable({
      modelKey: 'xgboost_full_v1',
      predictionRunId: '00000000-0000-4000-8000-000000000001',
    });
    assert.equal(unknown.json().error.code, 'PREDICTION_RESERVATION_MISMATCH');

    ctx.reservations.add(
      makeReservation({ reservationId: '900000000001010', status: 'CANCELLED' }),
    );
    ctx.reservations.add(
      makeReservation({
        reservationId: '900000000001011',
        appointmentAt: new Date('2026-10-20T15:00:00Z'),
      }),
    );
    for (const [id, reason] of [
      ['900000000001010', 'RESERVATION_NOT_SCHEDULED'],
      ['900000000001011', 'APPOINTMENT_NOT_FUTURE'],
    ] as const) {
      const state = (await get(`/api/v1/reservations/${id}/overbooking-authorization`)).json().data;
      assert.ok(
        state.eligibility.reasons.some((r: { code: string }) => r.code === reason),
        id,
      );
    }
    const missing = await enable(
      { modelKey: 'xgboost_full_v1', predictionRunId: runs.xgb },
      '900000000009999',
    );
    assert.deepEqual(
      [missing.statusCode, missing.json().error.code],
      [404, 'RESERVATION_NOT_FOUND'],
    );
  });

  it('HU-07 rechaza sin predicción, con run ajeno y cita cancelada; HU-08 sin HU-06 ⇒ 409 y cero INSERT', async () => {
    ctx = scenario();
    ctx.clock.set(AFTER_APPOINTMENT);
    const noPrediction = await recordAttendance({
      attendanceStatus: 'ATTENDED',
      predictionRunId: '00000000-0000-4000-8000-000000000001',
    });
    assert.deepEqual(
      [noPrediction.statusCode, noPrediction.json().error.code],
      [409, 'PREDICTION_REQUIRED'],
    );
    const blocker = (await get(`/api/v1/reservations/${ID}/attendance-outcome`)).json().data
      .registration;
    assert.deepEqual([blocker.registrable, blocker.blocker], [false, 'PREDICTION_REQUIRED']);

    ctx.clock.set(new Date('2026-10-25T15:00:00.000Z'));
    await predict();
    ctx.reservations.add(makeReservation({ reservationId: OTHER }));
    ctx.evidence.add(makeBookingEvidence({ reservationId: OTHER }));
    const otherRuns = await predict(OTHER);
    ctx.clock.set(AFTER_APPOINTMENT);
    const foreign = await recordAttendance({
      attendanceStatus: 'ATTENDED',
      predictionRunId: otherRuns.rf,
    });
    assert.deepEqual(
      [foreign.statusCode, foreign.json().error.code],
      [409, 'PREDICTION_RESERVATION_MISMATCH'],
    );

    ctx.reservations.add(
      makeReservation({ reservationId: '900000000001010', status: 'CANCELLED' }),
    );
    const cancelled = await recordAttendance(
      { attendanceStatus: 'NO_SHOW', predictionRunId: otherRuns.rf },
      '900000000001010',
    );
    assert.deepEqual(
      [cancelled.statusCode, cancelled.json().error.code],
      [409, 'RESERVATION_CANCELLED'],
    );

    // Sin hora de término acreditada por la fuente no se inventa que la cita terminó.
    ctx.reservations.add(makeReservation({ reservationId: '900000000001012' }));
    ctx.evidence.add(
      makeBookingEvidence({ reservationId: '900000000001012', appointmentEndAt: null }),
    );
    const unknownEnd = await recordAttendance(
      { attendanceStatus: 'NO_SHOW', predictionRunId: otherRuns.rf },
      '900000000001012',
    );
    assert.equal(unknownEnd.json().error.details.reason, 'APPOINTMENT_END_UNKNOWN');

    const recovery = await recordRecovery({ spaceRecovered: true });
    assert.deepEqual(
      [recovery.statusCode, recovery.json().error.code],
      [409, 'PREVENTIVE_ACTION_REQUIRED'],
    );
    const recoveryState = (await get(`/api/v1/reservations/${ID}/space-recovery-outcome`)).json()
      .data;
    assert.deepEqual(
      [recoveryState.recorded, recoveryState.spaceRecovered, recoveryState.blocker],
      [false, null, 'PREVENTIVE_ACTION_REQUIRED'],
    );
    assert.equal(ctx.operations.inserts, 0, 'ningún rechazo escribe');
  });

  it('contrato estricto: 400 sin coerción (booleanos, enums, UUID, extras), 401 antes de validar, requestId en errores', async () => {
    ctx = scenario();
    const invalidRecoveries = [
      {},
      { spaceRecovered: null },
      { spaceRecovered: 'true' },
      { spaceRecovered: 1 },
      { spaceRecovered: true, extra: 1 },
    ];
    for (const body of invalidRecoveries) {
      const response = await recordRecovery(body);
      assert.equal(response.statusCode, 400, JSON.stringify(body));
      assert.equal(response.json().error.code, 'REQUEST_VALIDATION_ERROR');
      assert.equal(response.json().requestId, response.headers['x-request-id']);
    }
    for (const body of [
      { modelKey: 'random_forest_full_v1' },
      { modelKey: 'ensemble', predictionRunId: '00000000-0000-4000-8000-000000000001' },
      { modelKey: 'random_forest_full_v1', predictionRunId: 'not-a-uuid' },
      {
        modelKey: 'random_forest_full_v1',
        predictionRunId: '00000000-0000-4000-8000-000000000001',
        riskLevel: 'HIGH',
      },
      {
        modelKey: 'random_forest_full_v1',
        predictionRunId: '00000000-0000-4000-8000-000000000001',
        clinicId: 2,
      },
    ]) {
      assert.equal((await enable(body)).statusCode, 400, JSON.stringify(body));
    }
    for (const body of [
      { attendanceStatus: 'CANCELLED', predictionRunId: '00000000-0000-4000-8000-000000000001' },
      { attendanceStatus: ['NO_SHOW'], predictionRunId: '00000000-0000-4000-8000-000000000001' },
      { attendanceStatus: 'NO_SHOW' },
    ]) {
      assert.equal((await recordAttendance(body)).statusCode, 400, JSON.stringify(body));
    }
    assert.equal((await get('/api/v1/overbooking-authorizations?from=2026-11-01')).statusCode, 400);
    assert.equal((await get(`/api/v1/reservations/12abc/attendance-outcome`)).statusCode, 400);

    const unauthenticated = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/reservations/${ID}/space-recovery-outcomes`,
      payload: { spaceRecovered: 'not-even-valid' },
    });
    assert.equal(unauthenticated.statusCode, 401, '401 antes de validar o revelar existencia');
    assert.equal(
      (await ctx.app.inject({ method: 'GET', url: `/api/v1/attendance-outcomes?${NOVEMBER}` }))
        .statusCode,
      401,
    );
    const tooLarge = await recordRecovery({ spaceRecovered: true, pad: 'x'.repeat(2048) });
    assert.equal(tooLarge.statusCode, 413);
    assert.equal(ctx.operations.inserts, 0);
  });

  it('listados: filtro Lima, sede, alcance, keyset sin duplicados, cursor firmado y 422 semánticos', async () => {
    ctx = scenario();
    const ids = ['900000000001101', '900000000001102', '900000000001103'];
    for (const [index, id] of ids.entries()) {
      ctx.reservations.add(makeReservation({ reservationId: id, clinicId: index === 2 ? 2 : 1 }));
      ctx.evidence.add(makeBookingEvidence({ reservationId: id }));
      const runs = await predict(id);
      assert.equal(
        (await enable({ modelKey: 'xgboost_full_v1', predictionRunId: runs.xgb }, id)).statusCode,
        201,
      );
    }
    const first = (await get(`/api/v1/overbooking-authorizations?${NOVEMBER}&limit=2`)).json();
    assert.equal(first.data.length, 2);
    const second = (
      await get(
        `/api/v1/overbooking-authorizations?${NOVEMBER}&limit=2&cursor=${first.pagination.nextCursor}`,
      )
    ).json();
    assert.deepEqual(
      [...first.data, ...second.data].map((a: { reservationId: string }) => a.reservationId),
      ids,
    );
    assert.equal(second.pagination.nextCursor, null);
    const clinic2 = (await get(`/api/v1/overbooking-authorizations?${NOVEMBER}&clinicId=2`)).json()
      .data;
    assert.deepEqual(
      clinic2.map((a: { reservationId: string }) => a.reservationId),
      [ids[2]],
    );
    const october = (
      await get('/api/v1/overbooking-authorizations?from=2026-10-01&to=2026-10-31')
    ).json();
    assert.deepEqual(october.data, []);

    const reused = await get(
      `/api/v1/attendance-outcomes?${NOVEMBER}&limit=2&cursor=${first.pagination.nextCursor}`,
    );
    assert.deepEqual([reused.statusCode, reused.json().error.code], [422, 'INVALID_CURSOR']);
    assert.equal(
      (await get(`/api/v1/space-recovery-outcomes?${NOVEMBER}&clinicId=99`)).json().error.code,
      'UNKNOWN_CLINIC',
    );
    assert.equal(
      (await get('/api/v1/space-recovery-outcomes?from=2026-01-01&to=2026-12-31')).json().error
        .code,
      'INVALID_PERIOD',
    );
  });

  it('GET de Sprint 02 son lecturas puras: sin INSERT, sin llamadas a Python', async () => {
    ctx = scenario();
    const runs = await predict();
    const calls = ctx.ml.calls.length;
    const before = ctx.operations.inserts;
    for (const url of [
      `/api/v1/reservations/${ID}/overbooking-authorization`,
      `/api/v1/reservations/${ID}/attendance-outcome`,
      `/api/v1/reservations/${ID}/space-recovery-outcome`,
      `/api/v1/overbooking-authorizations?${NOVEMBER}`,
      `/api/v1/attendance-outcomes?${NOVEMBER}`,
      `/api/v1/space-recovery-outcomes?${NOVEMBER}`,
      `/api/v1/reservations/${ID}`,
      `/api/v1/reservations?${NOVEMBER}`,
    ]) {
      assert.equal((await get(url)).statusCode, 200, url);
    }
    assert.equal(ctx.ml.calls.length, calls);
    assert.equal(ctx.operations.inserts, before);
    assert.ok(runs.rf);
  });

  it('almacén no disponible ⇒ 503 PERSISTENCE_UNAVAILABLE en comandos (nunca «sin registros» falso)', async () => {
    ctx = scenario();
    const runs = await predict();
    ctx.operations.failWith = new PersistenceUnavailableException({
      operation: 'FindOverbookingAuthorization',
    });
    const response = await enable({ modelKey: 'random_forest_full_v1', predictionRunId: runs.rf });
    assert.deepEqual(
      [response.statusCode, response.json().error.code],
      [503, 'PERSISTENCE_UNAVAILABLE'],
    );
  });
});
