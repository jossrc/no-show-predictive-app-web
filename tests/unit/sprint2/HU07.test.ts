/**
 * Sprint 02 – HU-07: Registro del resultado real de la predicción.
 * Ejecuta el caso de uso RecordAttendanceOutcome con las reglas appointment_finished_rule_v1 y
 * binary_outcome_threshold_v1 (umbral técnico PROVISIONAL 0.5, no una política operativa validada).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AFTER_APPOINTMENT_END,
  ALL_CLINICS,
  DURING_APPOINTMENT,
  RESERVATION_ID,
  scoreRun,
  setupSprint02,
} from './support/Sprint02TestContext.js';

const OTHER_RESERVATION_ID = '900000000001002';

function attendanceInput(predictionRunId: string, attendanceStatus: 'ATTENDED' | 'NO_SHOW') {
  return {
    reservationId: RESERVATION_ID,
    clinicScope: ALL_CLINICS,
    attendanceStatus,
    predictionRunId,
    requestId: 'sprint2-attendance',
  };
}

describe('HU-07 – Registro del resultado real de la predicción', () => {
  it('UT-04: no permite registrar la asistencia de una cita que todavía no ha finalizado', async () => {
    const ctx = setupSprint02(DURING_APPOINTMENT);
    const run = await scoreRun(ctx.store, { rf: 0.7, xgb: 0.7 });

    await assert.rejects(ctx.attendance.execute(attendanceInput(run, 'NO_SHOW')), {
      code: 'APPOINTMENT_NOT_FINISHED',
      details: {
        reason: 'APPOINTMENT_IN_PROGRESS',
        reasonMessage: 'La cita aún no termina según su horario programado',
      },
    });
    assert.equal(ctx.operations.attendanceRows.length, 0);
    assert.equal(ctx.operations.inserts, 0);
  });

  it('UT-05: registra ATTENDED o NO_SHOW asociado a una predicción previa válida de la misma reserva', async () => {
    for (const status of ['ATTENDED', 'NO_SHOW'] as const) {
      const ctx = setupSprint02(AFTER_APPOINTMENT_END);
      const run = await scoreRun(ctx.store, { rf: 0.7, xgb: 0.7 });

      const { outcome, replayed } = await ctx.attendance.execute(attendanceInput(run, status));

      assert.equal(replayed, false);
      assert.equal(outcome.reservationId, RESERVATION_ID);
      assert.equal(outcome.attendanceStatus, status);
      assert.equal(outcome.observedNoShow, status === 'NO_SHOW');
      assert.equal(outcome.predictionRunId, run);
      assert.equal(outcome.finishedRuleVersion, 'appointment_finished_rule_v1');
      const runResultIds = (
        await ctx.store.findRunResults(RESERVATION_ID, run, 'VERIFIED_BOOKING_SNAPSHOT')
      ).map((score) => score.resultId);
      assert.deepEqual(
        outcome.comparisons.map((comparison) => comparison.predictionResultId),
        runResultIds,
        'cada comparación referencia un resultado del run indicado',
      );
      assert.equal(ctx.operations.attendanceRows.length, 1);
    }

    // Una predicción de OTRA reserva no es válida para esta: se rechaza sin registrar nada.
    const mismatch = setupSprint02(AFTER_APPOINTMENT_END);
    await scoreRun(mismatch.store, { xgb: 0.7 });
    const foreignRun = await scoreRun(
      mismatch.store,
      { xgb: 0.7 },
      { reservationId: OTHER_RESERVATION_ID },
    );
    await assert.rejects(mismatch.attendance.execute(attendanceInput(foreignRun, 'NO_SHOW')), {
      code: 'PREDICTION_RESERVATION_MISMATCH',
    });
    assert.equal(mismatch.operations.inserts, 0);
  });

  it('UT-06: compara lo observado con Random Forest y XGBoost por separado (umbral provisional 0.5)', async () => {
    const ctx = setupSprint02(AFTER_APPOINTMENT_END);
    // RF en el borde exacto del umbral (0.5 ⇒ inasistencia predicha). XGB con 0.45: banda
    // experimental HIGH pero bajo el umbral 0.5 ⇒ el umbral binario no equivale a la banda.
    const run = await scoreRun(ctx.store, { rf: 0.5, xgb: 0.45 });

    const { outcome } = await ctx.attendance.execute(attendanceInput(run, 'NO_SHOW'));

    assert.deepEqual(
      outcome.comparisons.map((comparison) => ({
        modelKey: comparison.modelKey,
        probabilityNoShow: comparison.probabilityNoShow,
        predictedNoShow: comparison.predictedNoShow,
        observedNoShow: comparison.observedNoShow,
        matchesPrediction: comparison.matchesPrediction,
        threshold: comparison.threshold,
        comparisonRuleVersion: comparison.comparisonRuleVersion,
      })),
      [
        {
          modelKey: 'random_forest_full_v1',
          probabilityNoShow: 0.5,
          predictedNoShow: true,
          observedNoShow: true,
          matchesPrediction: true,
          threshold: 0.5,
          comparisonRuleVersion: 'binary_outcome_threshold_v1',
        },
        {
          modelKey: 'xgboost_full_v1',
          probabilityNoShow: 0.45,
          predictedNoShow: false,
          observedNoShow: true,
          matchesPrediction: false,
          threshold: 0.5,
          comparisonRuleVersion: 'binary_outcome_threshold_v1',
        },
      ],
      'una comparación por modelo, sin ensemble ni ganador',
    );
    const xgb = outcome.comparisons.find((c) => c.modelKey === 'xgboost_full_v1');
    assert.equal(xgb?.experimentalRiskLevel, 'HIGH');
  });
});
