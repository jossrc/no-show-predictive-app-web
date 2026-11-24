/**
 * Sprint 02 – HU-06: Habilitación de horarios para sobreasignación preventiva.
 * Ejecuta OverbookingEligibilityResolver (regla overbooking_eligibility_v1) y el caso de uso
 * EnableOverbooking sobre almacenes en memoria y datos sintéticos.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeReservation } from '../../helpers/MakeSyntheticReservation.js';
import {
  AFTER_APPOINTMENT_END,
  enableInput,
  scoreRun,
  setupSprint02,
} from './support/Sprint02TestContext.js';

interface NotEligibleError {
  readonly code?: string;
  readonly reasons?: ReadonlyArray<{ readonly code: string }>;
}

describe('HU-06 – Habilitación de horarios para sobreasignación', () => {
  it('UT-01: reserva SCHEDULED, futura y con banda experimental HIGH vigente es elegible', async () => {
    const ctx = setupSprint02();
    const run = await scoreRun(ctx.store, { xgb: 0.9 });

    const { eligibility } = await ctx.eligibility.resolve(makeReservation(), false);

    assert.equal(eligibility.ruleVersion, 'overbooking_eligibility_v1');
    assert.equal(eligibility.eligible, true);
    assert.deepEqual(eligibility.reasons, []);
    assert.equal(eligibility.candidates.length, 1);
    const [candidate] = eligibility.candidates;
    assert.equal(candidate?.modelKey, 'xgboost_full_v1');
    assert.equal(candidate?.predictionRunId, run);
    assert.equal(candidate?.experimentalRiskLevel, 'HIGH');
    assert.equal(candidate?.eligible, true);
  });

  it('UT-02: rechaza la habilitación si no se cumplen las condiciones (banda no HIGH o cita no futura)', async () => {
    // Banda experimental LOW: la reserva está programada y es futura, pero el riesgo no es Alto.
    const low = setupSprint02();
    const lowRun = await scoreRun(low.store, { xgb: 0.1 });
    await assert.rejects(
      low.enable.execute(enableInput(lowRun)),
      (error: NotEligibleError) =>
        error.code === 'OVERBOOKING_NOT_ELIGIBLE' &&
        error.reasons?.some((reason) => reason.code === 'PREDICTION_NOT_HIGH') === true,
    );
    assert.equal(low.operations.authorizationRows.length, 0);
    assert.equal(low.operations.inserts, 0);

    // Banda HIGH, pero la cita ya pasó según el reloj: deja de ser futura.
    const past = setupSprint02(AFTER_APPOINTMENT_END);
    const highRun = await scoreRun(past.store, { xgb: 0.9 });
    await assert.rejects(
      past.enable.execute(enableInput(highRun)),
      (error: NotEligibleError) =>
        error.code === 'OVERBOOKING_NOT_ELIGIBLE' &&
        error.reasons?.some((reason) => reason.code === 'APPOINTMENT_NOT_FUTURE') === true,
    );
    assert.equal(past.operations.inserts, 0);
  });

  it('UT-03: una habilitación válida se registra y un reintento equivalente no la duplica', async () => {
    const ctx = setupSprint02();
    const run = await scoreRun(ctx.store, { xgb: 0.9 });

    const first = await ctx.enable.execute(enableInput(run));
    assert.equal(first.replayed, false);
    assert.equal(first.authorization.status, 'ENABLED');
    assert.equal(first.authorization.predictionRunId, run);
    assert.equal(first.authorization.modelKey, 'xgboost_full_v1');
    assert.equal(first.authorization.riskBandAtAuthorization, 'HIGH');
    assert.equal(first.authorization.probabilityNoShowAtAuthorization, 0.9);
    assert.equal(first.authorization.eligibilityRuleVersion, 'overbooking_eligibility_v1');

    const retry = await ctx.enable.execute(enableInput(run));
    assert.equal(retry.replayed, true);
    assert.equal(retry.authorization.authorizationId, first.authorization.authorizationId);
    assert.equal(ctx.operations.authorizationRows.length, 1);
    assert.equal(ctx.operations.inserts, 1);
  });
});
