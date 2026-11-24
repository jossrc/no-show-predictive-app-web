import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateRetentionEligibility,
  type RetentionEligibilityInput,
} from '../../../../src/modules/CustomerRetention/Shared/rules/RetentionEligibility.js';
import type { ReservationScoreSummary } from '../../../../src/modules/Reservations/Shared/models/ReservationScoreSummary.js';
import { retentionWindow } from '../../../../src/modules/CustomerRetention/Shared/rules/RetentionWindow.js';
import { makeReservation } from '../../../helpers/MakeSyntheticReservation.js';
import {
  createRetentionContext,
  filters,
  hoursFromNow,
  importInput,
  importRow,
  NOW,
  scoreReservation,
  seedContact,
  toCsv,
  type RetentionContext,
} from '../../../helpers/RetentionTestContext.js';

const OLD_POLICY = 'a'.repeat(64);

async function idsOf(ctx: RetentionContext, overrides: Parameters<typeof filters>[0] = {}) {
  const result = await ctx.list.execute({ filters: filters(overrides), limit: 100, cursor: null });
  return result.items.map((item) => item.reservation.reservationId);
}

/** Escenario: una reserva por condición de elegibilidad, todas con el mismo cliente sintético. */
async function scenario(): Promise<RetentionContext> {
  const ctx = createRetentionContext();
  const source = (id: string, hours: number, status: 'SCHEDULED' | 'CANCELLED' = 'SCHEDULED') =>
    ctx.addSourceReservation({ reservationId: id, appointmentAt: hoursFromNow(hours), status });

  source('900000000801001', 24); // HIGH vigente en 24 h ⇒ incluida
  source('900000000801002', 71.9); // HIGH vigente cerca del límite ⇒ incluida
  source('900000000801003', 80); // fuera de la ventana de 72 h
  source('900000000801004', 30, 'CANCELLED'); // cancelada
  source('900000000801005', -2); // cita pasada
  source('900000000801006', 20); // banda MEDIUM
  source('900000000801007', 20); // sin estimación
  source('900000000801008', 20); // HIGH de una política anterior
  for (const id of ['900000000801001', '900000000801002', '900000000801003', '900000000801004']) {
    await scoreReservation(ctx.store, id, { model: 'xgb', probability: 0.8 });
  }
  await scoreReservation(ctx.store, '900000000801005', { model: 'xgb', probability: 0.9 });
  await scoreReservation(ctx.store, '900000000801006', { model: 'xgb', probability: 0.3 });
  await scoreReservation(ctx.store, '900000000801008', {
    model: 'xgb',
    probability: 0.95,
    policyHash: OLD_POLICY,
    scoredAt: new Date('2026-11-01T00:00:00.000Z'),
  });

  // Reserva incorporada por archivo, HIGH vigente en 47 h ⇒ incluida con su procedencia.
  ctx.references.addClient('900000000702001');
  await ctx.importer.execute(
    importInput(
      'nuevas.csv',
      toCsv([importRow({ DiaryGID: '900000000801009', DiaryGDate: '2026-11-12' })]),
    ),
  );
  await scoreReservation(ctx.store, '900000000801009', { model: 'xgb', probability: 0.7 });
  return ctx;
}

describe('Clientes prioritarios para retención (retention_priority_v1)', () => {
  it('incluye solo reservas programadas, futuras, dentro de 72 h y con banda HIGH vigente (fuente e importadas)', async () => {
    const ctx = await scenario();
    const runsBefore = ctx.store.runs.length;
    const contactsBefore = ctx.contacts.inserts;
    const result = await ctx.list.execute({ filters: filters(), limit: 100, cursor: null });

    assert.deepEqual(
      result.items.map((item) => item.reservation.reservationId),
      ['900000000801001', '900000000801009', '900000000801002'],
    );
    const imported = result.items.find((item) => item.reservation.origin === 'IMPORT');
    assert.equal(imported?.reservation.reservationId, '900000000801009');
    for (const item of result.items) {
      assert.equal(item.experimentalRisk.level, 'HIGH');
      assert.equal(item.experimentalRisk.policyHash, result.query.policy?.policyHash);
      assert.equal(item.score.modelKey, 'xgboost_full_v1');
      assert.equal(item.retentionStatus, 'PENDING');
      assert.equal(item.contact, null);
    }
    assert.equal(result.query.window.endInclusive.toISOString(), '2026-11-13T15:00:00.000Z');
    assert.equal(ctx.store.runs.length, runsBefore, 'la consulta no genera predicciones');
    assert.equal(ctx.contacts.inserts, contactsBefore, 'la consulta no escribe');
  });

  it('excluye reservas sin estimación, canceladas, pasadas, fuera de ventana o de políticas no vigentes', () => {
    const window = retentionWindow(NOW);
    const high: ReservationScoreSummary = {
      modelKey: 'xgboost_full_v1' as const,
      modelVersion: 'v',
      modelHash: 'h',
      probabilityNoShow: 0.8,
      scoredAt: NOW,
      predictionRunId: 'run-1',
      experimentalRisk: {
        level: 'HIGH',
        label: 'Alto (exploratorio)',
        status: 'RESEARCH_PROVISIONAL',
        policyId: 'p',
        policyVersion: 'research_risk_v1_1',
        policyHash: 'b'.repeat(64),
      },
    };
    const base: RetentionEligibilityInput = {
      reservation: makeReservation({ appointmentAt: hoursFromNow(10) }),
      window,
      latestScore: high,
      currentPolicyHash: 'b'.repeat(64),
      predictionRunId: null,
    };
    const cases: Array<[string, Partial<RetentionEligibilityInput>, string[]]> = [
      ['elegible', {}, []],
      [
        'límite exacto de 72 h',
        { reservation: makeReservation({ appointmentAt: hoursFromNow(72) }) },
        [],
      ],
      ['sin estimación', { latestScore: null }, ['NOT_SCORED']],
      [
        'cancelada',
        { reservation: makeReservation({ status: 'CANCELLED', appointmentAt: hoursFromNow(5) }) },
        ['RESERVATION_NOT_SCHEDULED'],
      ],
      [
        'pasada',
        { reservation: makeReservation({ appointmentAt: hoursFromNow(-1) }) },
        ['APPOINTMENT_NOT_FUTURE'],
      ],
      [
        '72 h + 1 min',
        { reservation: makeReservation({ appointmentAt: hoursFromNow(72 + 1 / 60) }) },
        ['APPOINTMENT_OUTSIDE_RETENTION_WINDOW'],
      ],
      [
        'política no vigente',
        { currentPolicyHash: 'c'.repeat(64) },
        ['RESEARCH_POLICY_NOT_CURRENT'],
      ],
      ['sin política vigente', { currentPolicyHash: null }, ['RESEARCH_POLICY_NOT_CURRENT']],
      [
        'sin banda experimental',
        { latestScore: { ...high, experimentalRisk: null } },
        ['EXPERIMENTAL_BAND_UNAVAILABLE'],
      ],
      [
        'banda no alta',
        {
          latestScore: {
            ...high,
            experimentalRisk: {
              ...high.experimentalRisk!,
              level: 'MEDIUM',
              label: 'Medio (exploratorio)',
            },
          },
        },
        ['PREDICTION_NOT_HIGH'],
      ],
    ];
    for (const [name, overrides, expected] of cases) {
      const reasons = evaluateRetentionEligibility({ ...base, ...overrides });
      assert.deepEqual(
        reasons.map((reason) => reason.code),
        expected,
        name,
      );
    }
  });

  it('aplica filtros de sede, modelo y estado de gestión, ordena y pagina sin duplicar filas', async () => {
    const ctx = await scenario();
    ctx.addSourceReservation({
      reservationId: '900000000801010',
      clinicId: 2,
      appointmentAt: hoursFromNow(12),
    });
    await scoreReservation(ctx.store, '900000000801010', { model: 'xgb', probability: 0.99 });
    // RF independiente: solo 801006 tiene RF HIGH; nunca se combina con XGB.
    await scoreReservation(ctx.store, '900000000801006', { model: 'rf', probability: 0.9 });
    await scoreReservation(ctx.store, '900000000801001', { model: 'rf', probability: 0.1 });

    assert.deepEqual(await idsOf(ctx, { clinicId: 2 }), ['900000000801010']);
    assert.deepEqual(await idsOf(ctx, { modelKey: 'random_forest_full_v1' }), ['900000000801006']);
    assert.deepEqual(await idsOf(ctx, { sort: 'probabilityNoShow', direction: 'desc' }), [
      '900000000801010',
      '900000000801001',
      '900000000801002',
      '900000000801009',
    ]);

    await seedContact(ctx, '900000000801001');
    assert.deepEqual(await idsOf(ctx, { retentionStatus: 'CAMPAIGN_SENT' }), ['900000000801001']);
    assert.deepEqual(await idsOf(ctx, { retentionStatus: 'PENDING' }), [
      '900000000801010',
      '900000000801009',
      '900000000801002',
    ]);

    // Paginación keyset de 1 en 1 con orden por probabilidad: mismas filas, sin repeticiones.
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await ctx.list.execute({
        filters: filters({ sort: 'probabilityNoShow', direction: 'desc' }),
        limit: 1,
        cursor,
      });
      seen.push(...page.items.map((item) => item.reservation.reservationId));
      cursor = page.nextCursor;
    } while (cursor !== null);
    assert.deepEqual(seen, await idsOf(ctx, { sort: 'probabilityNoShow', direction: 'desc' }));
    await assert.rejects(
      ctx.list.execute({
        filters: filters({ sort: 'appointmentAt' }),
        limit: 1,
        cursor: 'eyJ2IjoxfQ',
      }),
      { code: 'INVALID_CURSOR' },
    );
    await assert.rejects(
      ctx.list.execute({ filters: filters({ clinicId: 99 }), limit: 5, cursor: null }),
      {
        code: 'UNKNOWN_CLINIC',
      },
    );
  });
});
