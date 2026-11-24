/**
 * Sprint 02 – HU-08: Registro de espacios recuperados.
 * Ejecuta RecordSpaceRecoveryOutcome y GetSpaceRecoveryOutcome. El único requisito previo es la
 * habilitación preventiva HU-06; NO se exige una asistencia registrada (HU-07).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AFTER_APPOINTMENT_END,
  ALL_CLINICS,
  enableInput,
  RESERVATION_ID,
  scoreRun,
  setupSprint02,
} from './support/Sprint02TestContext.js';

function recoveryInput(spaceRecovered: boolean) {
  return {
    reservationId: RESERVATION_ID,
    clinicScope: ALL_CLINICS,
    spaceRecovered,
    requestId: 'sprint2-recovery',
  };
}

/** Contexto con la habilitación HU-06 ya registrada y el reloj tras el fin de la cita. */
async function setupWithAuthorization() {
  const ctx = setupSprint02();
  const run = await scoreRun(ctx.store, { xgb: 0.9 });
  const { authorization } = await ctx.enable.execute(enableInput(run));
  ctx.clock.set(AFTER_APPOINTMENT_END);
  return { ctx, authorization };
}

describe('HU-08 – Registro de espacios recuperados', () => {
  it('UT-07: no permite registrar una recuperación sin una habilitación preventiva previa', async () => {
    // Reserva con predicción HIGH, pero nunca habilitada para sobreasignación (sin HU-06).
    const ctx = setupSprint02();
    await scoreRun(ctx.store, { xgb: 0.9 });
    ctx.clock.set(AFTER_APPOINTMENT_END);

    await assert.rejects(ctx.recovery.execute(recoveryInput(true)), {
      code: 'PREVENTIVE_ACTION_REQUIRED',
    });
    assert.equal(ctx.operations.recoveryRows.length, 0);
    assert.equal(ctx.operations.inserts, 0);
  });

  it('UT-08: registra spaceRecovered=true cuando existe una habilitación válida', async () => {
    const { ctx, authorization } = await setupWithAuthorization();

    const { outcome, replayed } = await ctx.recovery.execute(recoveryInput(true));

    assert.equal(replayed, false);
    assert.equal(outcome.spaceRecovered, true);
    assert.equal(outcome.reservationId, RESERVATION_ID);
    assert.equal(outcome.authorizationId, authorization.authorizationId);
    assert.equal(outcome.appointmentAt.toISOString(), authorization.appointmentAt.toISOString());
    assert.equal(ctx.operations.recoveryRows.length, 1);
    assert.equal(
      ctx.operations.attendanceRows.length,
      0,
      'no se requiere asistencia HU-07 registrada',
    );
  });

  it('UT-09: registra spaceRecovered=false sin confundirlo con un resultado no registrado (null)', async () => {
    const { ctx, authorization } = await setupWithAuthorization();
    const query = { reservationId: RESERVATION_ID, clinicScope: ALL_CLINICS };

    // Antes de registrar: hay habilitación, pero el resultado es null (sin registro).
    const before = await ctx.getRecovery.execute(query);
    assert.equal(before.authorization?.authorizationId, authorization.authorizationId);
    assert.equal(before.outcome, null);

    const { outcome } = await ctx.recovery.execute(recoveryInput(false));
    assert.equal(outcome.spaceRecovered, false);

    // Después: existe un registro explícito cuyo valor es false (no null, no ausente).
    const after = await ctx.getRecovery.execute(query);
    assert.notEqual(after.outcome, null);
    assert.equal(after.outcome?.spaceRecovered, false);
    assert.equal(after.outcome?.authorizationId, authorization.authorizationId);
    assert.equal(ctx.operations.recoveryRows.length, 1);
  });
});
