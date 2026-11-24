import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUTH_HEADERS } from '../../../helpers/BuildTestApp.js';
import { SYNTHETIC_CLIENT_ID } from '../../../helpers/MakeSyntheticReservation.js';
import {
  ALL_CLINICS,
  buildRetentionApp,
  createRetentionContext,
  hoursFromNow,
  NOW,
  scoreReservation,
} from '../../../helpers/RetentionTestContext.js';

const ELIGIBLE = '900000000851001';

async function eligibleContext() {
  const ctx = createRetentionContext();
  ctx.addSourceReservation({ reservationId: ELIGIBLE, appointmentAt: hoursFromNow(24) });
  const run = await scoreReservation(ctx.store, ELIGIBLE, { model: 'xgb', probability: 0.82 });
  return { ctx, run };
}

function input(predictionRunId: string, overrides: Record<string, unknown> = {}) {
  return {
    reservationId: ELIGIBLE,
    clientId: SYNTHETIC_CLIENT_ID,
    modelKey: 'xgboost_full_v1' as const,
    predictionRunId,
    clinicScope: ALL_CLINICS,
    requestId: 'contact-test',
    ...overrides,
  };
}

describe('Registro de acciones de retención', () => {
  it('registra un contacto elegible con fecha del servidor, predicción de sustento y autoría técnica', async () => {
    const { ctx, run } = await eligibleContext();
    const app = buildRetentionApp(ctx);
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/reservations/${ELIGIBLE}/retention-contacts`,
        headers: AUTH_HEADERS,
        payload: {
          clientId: SYNTHETIC_CLIENT_ID,
          modelKey: 'xgboost_full_v1',
          predictionRunId: run,
        },
      });
      assert.equal(response.statusCode, 201);
      const { data } = response.json();
      const policy = await ctx.store.currentExperimentalPolicy(
        'xgboost_full_v1',
        'VERIFIED_BOOKING_SNAPSHOT',
      );
      assert.deepEqual(
        {
          reservationId: data.reservationId,
          clientId: data.clientId,
          retentionStatus: data.retentionStatus,
          retentionStatusLabel: data.retentionStatusLabel,
          contactedAt: data.contactedAt,
          modelKey: data.modelKey,
          predictionRunId: data.predictionRunId,
          riskBandAtContact: data.riskBandAtContact,
          probabilityNoShowAtContact: data.probabilityNoShowAtContact,
          researchPolicyHash: data.researchPolicyHash,
          eligibilityRuleVersion: data.eligibilityRuleVersion,
          communicationSent: data.communicationSent,
          actorKind: data.actorKind,
          actorUserId: data.actorUserId,
          replayed: data.replayed,
        },
        {
          reservationId: ELIGIBLE,
          clientId: SYNTHETIC_CLIENT_ID,
          retentionStatus: 'CAMPAIGN_SENT',
          retentionStatusLabel: 'Campaña de retención enviada',
          contactedAt: NOW.toISOString(),
          modelKey: 'xgboost_full_v1',
          predictionRunId: run,
          riskBandAtContact: 'HIGH',
          probabilityNoShowAtContact: 0.82,
          researchPolicyHash: policy?.policyHash,
          eligibilityRuleVersion: 'retention_priority_v1',
          communicationSent: false,
          actorKind: 'INTERNAL_SERVICE',
          actorUserId: null,
          replayed: false,
        },
      );
      const strict = await app.inject({
        method: 'POST',
        url: `/api/v1/reservations/${ELIGIBLE}/retention-contacts`,
        headers: AUTH_HEADERS,
        payload: { clientId: 900000000002001, modelKey: 'xgboost_full_v1', predictionRunId: run },
      });
      assert.equal(strict.statusCode, 400, 'identificadores numéricos JSON no se coercionan');
    } finally {
      await app.close();
    }
  });

  it('rechaza reservas no elegibles o inconsistentes sin escribir', async () => {
    const { ctx, run } = await eligibleContext();
    ctx.addSourceReservation({ reservationId: '900000000851002', appointmentAt: hoursFromNow(80) });
    ctx.addSourceReservation({
      reservationId: '900000000851003',
      appointmentAt: hoursFromNow(10),
      status: 'CANCELLED',
    });
    ctx.addSourceReservation({ reservationId: '900000000851004', appointmentAt: hoursFromNow(10) });
    const outside = await scoreReservation(ctx.store, '900000000851002', {
      model: 'xgb',
      probability: 0.9,
    });
    const cancelled = await scoreReservation(ctx.store, '900000000851003', {
      model: 'xgb',
      probability: 0.9,
    });
    const medium = await scoreReservation(ctx.store, '900000000851004', {
      model: 'xgb',
      probability: 0.3,
    });
    const newer = await scoreReservation(ctx.store, ELIGIBLE, {
      model: 'xgb',
      probability: 0.85,
      scoredAt: new Date('2026-11-10T12:00:00.000Z'),
      // Misma foto y modelo: solo una política research nueva produce un score posterior.
      policyHash: 'd'.repeat(64),
    });

    const cases: Array<[string, ReturnType<typeof input>, string, string | null]> = [
      [
        'inexistente',
        input(run, { reservationId: '900000000859999' }),
        'RESERVATION_NOT_FOUND',
        null,
      ],
      [
        'otro cliente',
        input(newer, { clientId: '900000000002999' }),
        'RESERVATION_CLIENT_MISMATCH',
        null,
      ],
      ['predicción de otra reserva', input(outside), 'PREDICTION_RESERVATION_MISMATCH', null],
      ['predicción no vigente', input(run), 'RETENTION_NOT_ELIGIBLE', 'PREDICTION_NOT_LATEST'],
      [
        'fuera de 72 h',
        input(outside, { reservationId: '900000000851002' }),
        'RETENTION_NOT_ELIGIBLE',
        'APPOINTMENT_OUTSIDE_RETENTION_WINDOW',
      ],
      [
        'cancelada',
        input(cancelled, { reservationId: '900000000851003' }),
        'RETENTION_NOT_ELIGIBLE',
        'RESERVATION_NOT_SCHEDULED',
      ],
      [
        'banda no alta',
        input(medium, { reservationId: '900000000851004' }),
        'RETENTION_NOT_ELIGIBLE',
        'PREDICTION_NOT_HIGH',
      ],
    ];
    for (const [name, request, code, reason] of cases) {
      await assert.rejects(
        ctx.record.execute(request),
        (error: { code?: string; reasons?: Array<{ code: string }> }) =>
          error.code === code &&
          (reason === null || error.reasons?.some((item) => item.code === reason) === true),
        name,
      );
    }
    assert.equal(ctx.contacts.inserts, 0);
  });

  it('es idempotente ante reintentos y solicitudes concurrentes, sin sobrescribir la fecha original', async () => {
    const { ctx, run } = await eligibleContext();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => ctx.record.execute(input(run))),
    );
    assert.equal(results.filter((result) => !result.replayed).length, 1);
    assert.equal(ctx.contacts.inserts, 1);
    assert.equal(new Set(results.map((result) => result.contact.contactId)).size, 1);

    ctx.clock.advanceMs(3_600_000);
    const retry = await ctx.record.execute(input(run));
    assert.equal(retry.replayed, true);
    assert.equal(retry.contact.contactedAt.toISOString(), NOW.toISOString());

    const rf = await scoreReservation(ctx.store, ELIGIBLE, { model: 'rf', probability: 0.9 });
    await assert.rejects(ctx.record.execute(input(rf, { modelKey: 'random_forest_full_v1' })), {
      code: 'RETENTION_CONTACT_ALREADY_RECORDED',
    });

    // Granularidad por reserva: otra cita del MISMO cliente se gestiona por separado.
    ctx.addSourceReservation({ reservationId: '900000000851005', appointmentAt: hoursFromNow(30) });
    const other = await scoreReservation(ctx.store, '900000000851005', {
      model: 'xgb',
      probability: 0.9,
    });
    const second = await ctx.record.execute(input(other, { reservationId: '900000000851005' }));
    assert.equal(second.replayed, false);
    assert.equal(ctx.contacts.inserts, 2);
  });

  it('el listado refleja el estado de gestión actualizado y su fecha tras el registro', async () => {
    const { ctx, run } = await eligibleContext();
    const app = buildRetentionApp(ctx);
    const list = async (query = '') =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/retention/priority-clients?modelKey=xgboost_full_v1${query}`,
          headers: AUTH_HEADERS,
        })
      ).json();
    try {
      const before = await list();
      assert.deepEqual(before.data[0].retention, {
        status: 'PENDING',
        statusLabel: 'Gestión pendiente',
        contactId: null,
        contactedAt: null,
        contactModelKey: null,
        contactPredictionRunId: null,
      });
      assert.equal(before.data[0].prediction.riskLevel, null);
      assert.equal(before.data[0].prediction.experimentalRisk.level, 'HIGH');
      assert.equal(before.window.hours, 72);

      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/reservations/${ELIGIBLE}/retention-contacts`,
        headers: AUTH_HEADERS,
        payload: {
          clientId: SYNTHETIC_CLIENT_ID,
          modelKey: 'xgboost_full_v1',
          predictionRunId: run,
        },
      });
      const contactId = created.json().data.contactId;

      const after = await list();
      assert.deepEqual(after.data[0].retention, {
        status: 'CAMPAIGN_SENT',
        statusLabel: 'Campaña de retención enviada',
        contactId,
        contactedAt: NOW.toISOString(),
        contactModelKey: 'xgboost_full_v1',
        contactPredictionRunId: run,
      });
      assert.equal((await list('&retentionStatus=CAMPAIGN_SENT')).data.length, 1);
      assert.equal((await list('&retentionStatus=PENDING')).data.length, 0);
    } finally {
      await app.close();
    }
  });
});
