import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { LightMyRequestResponse } from 'fastify';
import { AUTH_HEADERS } from '../../helpers/BuildTestApp.js';
import {
  buildSyntheticLocalApp,
  type SyntheticLocalApp,
} from '../../helpers/BuildSyntheticLocalApp.js';
import { FakePredictionClient } from '../../helpers/FakePredictionClient.js';
import { FixedClock } from '../../helpers/FixedClock.js';
import {
  createIsolatedStoreDatabase,
  type IsolatedStoreDatabase,
} from '../../helpers/PredictiveStoreTestDatabase.js';
import { reportSkipped } from '../../helpers/ReportSkipped.js';
import { probeTestDatabase } from '../../helpers/TestDatabase.js';

/**
 * E2E Sprint 02 de alta fidelidad: composition root REAL en SYNTHETIC_DEMO_ONLY (la fuente
 * PostgreSQL está PROHIBIDA: FORBIDDEN_POSTGRES), almacén PostgreSQL de la app en una base de
 * PRUEBA aislada con el rol runtime restringido y doble estricto de Python v2 (respuestas reales
 * publicadas). Reinicia el backend (pool nuevo) para verificar persistencia real.
 */
const skip = await probeTestDatabase();
reportSkipped('Sprint02DatabaseFlow', skip);

const CASE2 = '900000000101002'; // RF HIGH, XGB HIGH (casos publicados por Python)
const CASE3 = '900000000101003'; // RF MEDIUM, XGB HIGH
const CASE1 = '900000000101001'; // RF LOW, XGB LOW
const NOVEMBER = 'from=2026-11-01&to=2026-11-30';

describe(
  'Sprint 02 E2E sobre PostgreSQL de prueba (HU-06/07/08, sin fuente FLOWww)',
  { skip: skip ?? false },
  () => {
    let database: IsolatedStoreDatabase;
    let ctx: SyntheticLocalApp;
    const clock = new FixedClock(new Date('2026-10-25T15:00:00.000Z'));

    const strictMl = () => {
      const ml = new FakePredictionClient();
      ml.bandCasesByFeatures = true;
      return ml;
    };
    const start = async () => {
      ctx = await buildSyntheticLocalApp({ ml: strictMl(), storeDatabase: database, clock });
    };
    const get = (url: string): Promise<LightMyRequestResponse> =>
      ctx.app.inject({ method: 'GET', url, headers: AUTH_HEADERS });
    const post = (url: string, payload: object): Promise<LightMyRequestResponse> =>
      ctx.app.inject({ method: 'POST', url, headers: AUTH_HEADERS, payload });
    const count = async (table: string): Promise<number> => {
      const admin = await database.connect('admin');
      try {
        return Number(
          (await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)).rows[0]?.n,
        );
      } finally {
        await admin.end();
      }
    };
    const runsOf = async (id: string) => {
      const response = await post(`/api/v1/reservations/${id}/predictions`, { mode: 'compare' });
      assert.ok([200, 201].includes(response.statusCode), response.body);
      return Object.fromEntries(
        response
          .json()
          .data.models.map((m: { modelKey: string; predictionRunId: string }) => [
            m.modelKey,
            m.predictionRunId,
          ]),
      ) as Record<'random_forest_full_v1' | 'xgboost_full_v1', string>;
    };

    before(async () => {
      database = await createIsolatedStoreDatabase('SYNTHETIC_DEMO_ONLY');
      await start();
    });
    after(async () => {
      await ctx?.close();
      await database?.drop();
    });

    it('HU-06: elegibilidad por modelo, marca persistida y concurrencia ⇒ un único registro', async () => {
      const case3 = await runsOf(CASE3);
      const eligibility = (
        await get(`/api/v1/reservations/${CASE3}/overbooking-authorization`)
      ).json().data.eligibility;
      assert.deepEqual(
        eligibility.candidates.map(
          (c: { modelKey: string; experimentalRiskLevel: string; eligible: boolean }) => [
            c.modelKey,
            c.experimentalRiskLevel,
            c.eligible,
          ],
        ),
        [
          ['random_forest_full_v1', 'MEDIUM', false],
          ['xgboost_full_v1', 'HIGH', true],
        ],
      );
      const medium = await post(`/api/v1/reservations/${CASE3}/overbooking-authorizations`, {
        modelKey: 'random_forest_full_v1',
        predictionRunId: case3.random_forest_full_v1,
      });
      assert.deepEqual(
        [medium.statusCode, medium.json().error.code],
        [409, 'OVERBOOKING_NOT_ELIGIBLE'],
      );
      assert.equal(await count('ml.app_overbooking_authorizations'), 0, 'rechazo sin INSERT');

      const case2 = await runsOf(CASE2);
      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          post(`/api/v1/reservations/${CASE2}/overbooking-authorizations`, {
            modelKey: 'xgboost_full_v1',
            predictionRunId: case2.xgboost_full_v1,
          }),
        ),
      );
      assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 200, 200, 200, 200, 201]);
      assert.equal(await count('ml.app_overbooking_authorizations'), 1);
      assert.equal(new Set(responses.map((r) => r.json().data.authorizationId)).size, 1);

      const low = await runsOf(CASE1);
      const lowResponse = await post(`/api/v1/reservations/${CASE1}/overbooking-authorizations`, {
        modelKey: 'xgboost_full_v1',
        predictionRunId: low.xgboost_full_v1,
      });
      assert.equal(lowResponse.json().error.details.reasons[0].code, 'PREDICTION_NOT_HIGH');
    });

    it('reinicio del backend (pool nuevo): marca, listado y detalle se recuperan idénticos', async () => {
      const before = (await get(`/api/v1/reservations/${CASE2}/overbooking-authorization`)).json()
        .data;
      await ctx.close();
      await start();
      const after = (await get(`/api/v1/reservations/${CASE2}/overbooking-authorization`)).json()
        .data;
      assert.deepEqual(after.authorization, before.authorization);
      assert.equal(after.status, 'ENABLED');
      const listed = (await get(`/api/v1/reservations?${NOVEMBER}`)).json().data;
      const row = listed.find((r: { reservationId: string }) => r.reservationId === CASE2);
      assert.deepEqual([row.overbooking.enabled, row.attendanceOutcome.recorded], [true, false]);
      const others = listed.filter((r: { reservationId: string }) => r.reservationId !== CASE2);
      assert.ok(
        others.every((r: { overbooking: { enabled: boolean } }) => r.overbooking.enabled === false),
      );
      const authorizations = (await get(`/api/v1/overbooking-authorizations?${NOVEMBER}`)).json()
        .data;
      assert.deepEqual(
        authorizations.map((a: { reservationId: string }) => a.reservationId),
        [CASE2],
      );
    });

    it('HU-07 y HU-08 tras la cita: observaciones inmutables, comparaciones por modelo y listados', async () => {
      const run = (await get(`/api/v1/reservations/${CASE2}/attendance-outcome`)).json().data
        .registration;
      assert.deepEqual([run.registrable, run.blocker], [false, 'APPOINTMENT_NOT_STARTED']);
      clock.set(new Date('2026-11-17T21:00:00.000Z')); // fin programado 20:40 (dataset)
      const registration = (await get(`/api/v1/reservations/${CASE2}/attendance-outcome`)).json()
        .data.registration;
      assert.equal(registration.registrable, true);

      const attended = await post(`/api/v1/reservations/${CASE2}/attendance-outcomes`, {
        attendanceStatus: 'ATTENDED',
        predictionRunId: registration.availablePredictionRunIds[0],
      });
      assert.equal(attended.statusCode, 201, attended.body);
      assert.deepEqual(
        attended
          .json()
          .data.comparisons.map(
            (c: { modelKey: string; predictedNoShow: boolean; matchesPrediction: boolean }) => [
              c.modelKey,
              c.predictedNoShow,
              c.matchesPrediction,
            ],
          ),
        [
          ['random_forest_full_v1', true, false],
          ['xgboost_full_v1', true, false],
        ],
        'scores altos frente a una asistencia: no coincide (descriptivo)',
      );
      assert.equal(await count('ml.app_attendance_prediction_comparisons'), 2);

      const recovered = await post(`/api/v1/reservations/${CASE2}/space-recovery-outcomes`, {
        spaceRecovered: true,
      });
      assert.equal(recovered.statusCode, 201, recovered.body);
      const noAction = await post(`/api/v1/reservations/${CASE3}/space-recovery-outcomes`, {
        spaceRecovered: false,
      });
      assert.deepEqual(
        [noAction.statusCode, noAction.json().error.code],
        [409, 'PREVENTIVE_ACTION_REQUIRED'],
      );
      assert.equal(await count('ml.app_space_recovery_outcomes'), 1);

      await ctx.close();
      await start();
      const detail = (await get(`/api/v1/reservations/${CASE2}`)).json().data;
      assert.deepEqual(
        [
          detail.reservationStatus,
          detail.overbooking.status,
          detail.attendanceOutcome.attendanceStatus,
          detail.spaceRecoveryOutcome.spaceRecovered,
        ],
        ['SCHEDULED', 'ENABLED', 'ATTENDED', true],
      );
      const outcomes = (await get(`/api/v1/attendance-outcomes?${NOVEMBER}`)).json().data;
      assert.equal(outcomes.length, 1);
      assert.equal(outcomes[0].comparisons.length, 2);
      const recoveries = (
        await get(`/api/v1/space-recovery-outcomes?${NOVEMBER}&clinicId=1`)
      ).json().data;
      assert.deepEqual(
        recoveries.map((r: { spaceRecovered: boolean }) => r.spaceRecovered),
        [true],
      );
      const health = (
        await ctx.app.inject({ method: 'GET', url: '/api/v1/health/predictive-store' })
      ).json();
      assert.deepEqual(
        [health.driver, health.schemaVersion, health.restrictedRole],
        ['postgresql', '003', true],
      );
    });

    it('los registros son inmutables en la base (ni el superusuario de prueba puede editarlos)', async () => {
      const admin = await database.connect('admin');
      try {
        for (const sql of [
          "UPDATE ml.app_attendance_outcomes SET attendance_status = 'NO_SHOW'",
          'DELETE FROM ml.app_overbooking_authorizations',
          'UPDATE ml.app_space_recovery_outcomes SET space_recovered = false',
        ]) {
          await assert.rejects(admin.query(sql), /inmutables/, sql);
        }
      } finally {
        await admin.end();
      }
    });
  },
);
