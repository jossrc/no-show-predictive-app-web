import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import type { MlResearchPredictionResponse } from '../../../../../src/infrastructure/http/ml/MlContractTypes.js';
import { EXPERIMENTAL_RISK_LABELS } from '../../../../../src/infrastructure/http/ml/MlResearchContractSchemas.js';
import { bandImpliedByContract } from '../../../../../src/infrastructure/http/ml/MlResearchContractValidator.js';
import { EnableOverbooking } from '../../../../../src/modules/OperationalOptimization/EnableOverbooking/application/EnableOverbooking.js';
import { RecordAttendanceOutcome } from '../../../../../src/modules/OperationalOptimization/RecordAttendanceOutcome/application/RecordAttendanceOutcome.js';
import { RecordSpaceRecoveryOutcome } from '../../../../../src/modules/OperationalOptimization/RecordSpaceRecoveryOutcome/application/RecordSpaceRecoveryOutcome.js';
import { AppointmentFinishedResolver } from '../../../../../src/modules/OperationalOptimization/Shared/access/AppointmentFinishedResolver.js';
import { OverbookingEligibilityResolver } from '../../../../../src/modules/OperationalOptimization/Shared/access/OverbookingEligibilityResolver.js';
import { toNewModelScore } from '../../../../../src/modules/ReservationRisk/Shared/calculation/ToNewModelScore.js';
import { PendingValidationRiskLevelPolicy } from '../../../../../src/modules/ReservationRisk/Shared/policy/PendingValidationRiskLevelPolicy.js';
import { FakeBookingEvidenceSource } from '../../../../helpers/FakeBookingEvidenceSource.js';
import { FixedClock } from '../../../../helpers/FixedClock.js';
import { InMemoryOperationalStore } from '../../../../helpers/InMemoryOperationalStore.js';
import { InMemoryPredictiveStore } from '../../../../helpers/InMemoryPredictiveStore.js';
import { InMemoryReservationRepository } from '../../../../helpers/InMemoryReservationRepository.js';
import { loadMlGolden } from '../../../../helpers/LoadFixture.js';
import {
  makeBookingEvidence,
  makeReservation,
  makeStoredSnapshot,
  makeVerifiedSnapshot,
  SYNTHETIC_RESERVATION_ID as ID,
} from '../../../../helpers/MakeSyntheticReservation.js';

const ALL = { kind: 'ALL_CLINICS' } as const;
const policy = new PendingValidationRiskLevelPolicy();

function setup(now = new Date('2026-10-25T15:00:00.000Z')) {
  const store = new InMemoryPredictiveStore();
  const operations = new InMemoryOperationalStore();
  const reservations = new InMemoryReservationRepository(store, operations);
  const evidence = new FakeBookingEvidenceSource('CAPTURED_AT_BOOKING');
  const clock = new FixedClock(now);
  reservations.add(makeReservation());
  evidence.add(makeBookingEvidence());
  const eligibility = new OverbookingEligibilityResolver(
    store,
    'READ_ONLY_EXISTING_SCHEDULE',
    clock,
  );
  const enable = new EnableOverbooking({
    reservations,
    eligibility,
    runs: store,
    authorizations: operations.authorizations,
    mode: 'READ_ONLY_EXISTING_SCHEDULE',
    clock,
  });
  const attendance = new RecordAttendanceOutcome({
    reservations,
    finished: new AppointmentFinishedResolver(evidence, clock),
    scores: store,
    runs: store,
    outcomes: operations.attendance,
    mode: 'READ_ONLY_EXISTING_SCHEDULE',
    clock,
  });
  const recovery = new RecordSpaceRecoveryOutcome({
    reservations,
    authorizations: operations.authorizations,
    recoveries: operations.recoveries,
    clock,
  });
  return { store, operations, reservations, evidence, clock, enable, attendance, recovery };
}

/** Persiste un run real (contrato v2) con la probabilidad y la política indicadas. */
async function scoreRun(
  store: InMemoryPredictiveStore,
  probabilities: Partial<Record<'rf' | 'xgb', number>>,
  options: { scoredAt?: Date; policyHash?: string; reservationId?: string } = {},
): Promise<string> {
  const reservationId = options.reservationId ?? ID;
  const {
    snapshotId: _s,
    createdAt: _c,
    ...rest
  } = makeStoredSnapshot({
    verified: makeVerifiedSnapshot({ reservationId }),
  });
  const snapshot = await store.saveIfAbsent({
    ...rest,
    evidence: {},
    sourceIngestionBatchId: null,
  });
  const runUid = randomUUID();
  const scores = (Object.entries(probabilities) as Array<['rf' | 'xgb', number]>).map(
    ([model, p]) => {
      const golden = loadMlGolden<MlResearchPredictionResponse>(`golden_v2_predict_${model}`);
      const level = bandImpliedByContract(p, golden.experimental_risk);
      const response: MlResearchPredictionResponse = {
        ...golden,
        probability_no_show: p,
        experimental_risk: {
          ...golden.experimental_risk,
          level,
          label: EXPERIMENTAL_RISK_LABELS[level],
          ...(options.policyHash ? { policy_hash: options.policyHash } : {}),
        },
      };
      return toNewModelScore(
        response,
        snapshot,
        options.scoredAt ?? new Date('2026-10-24T00:00:00Z'),
        policy,
      );
    },
  );
  await store.saveRun(
    {
      runUid,
      snapshotId: snapshot.snapshotId,
      reservationId,
      mode: scores.length === 2 ? 'compare' : 'single',
      requestedModelKeys: scores.map((s) => s.modelKey),
      requestId: 'unit',
      runRequestedAt: new Date(),
      completedAt: new Date(),
      mlLatencyMs: 1,
      scoringApiVersion: 'v2',
    },
    scores,
  );
  return runUid;
}

const enableInput = (
  predictionRunId: string,
  modelKey: 'random_forest_full_v1' | 'xgboost_full_v1' = 'xgboost_full_v1',
) => ({
  reservationId: ID,
  clinicScope: ALL,
  modelKey,
  predictionRunId,
  requestId: 'req-1',
});

describe('EnableOverbooking (HU-06)', () => {
  it('rechaza un run anterior cuando existe un score más reciente del modelo (PREDICTION_NOT_LATEST)', async () => {
    const ctx = setup();
    const old = await scoreRun(ctx.store, { xgb: 0.9 }, { scoredAt: new Date('2026-10-23Z') });
    // Nueva política research ⇒ nuevo score (identidad distinta), el anterior queda desactualizado.
    const fresh = await scoreRun(
      ctx.store,
      { xgb: 0.92 },
      { scoredAt: new Date('2026-10-24Z'), policyHash: 'c'.repeat(64) },
    );
    await assert.rejects(
      ctx.enable.execute(enableInput(old)),
      (error: { code?: string; reasons?: Array<{ code: string }> }) =>
        error.code === 'OVERBOOKING_NOT_ELIGIBLE' &&
        error.reasons?.[0]?.code === 'PREDICTION_NOT_LATEST',
    );
    const created = await ctx.enable.execute(enableInput(fresh));
    assert.equal(created.authorization.researchPolicyHash, 'c'.repeat(64));
    assert.equal(created.authorization.predictionRunId, fresh);
  });

  it('RF y XGB son independientes: un score XGB posterior no desactualiza el RF; otro RF posterior sí', async () => {
    const ctx = setup();
    const rfRun = await scoreRun(ctx.store, { rf: 0.9 }, { scoredAt: new Date('2026-10-23Z') });
    await scoreRun(ctx.store, { xgb: 0.9 }, { scoredAt: new Date('2026-10-24Z') });
    assert.equal(
      (await ctx.enable.execute(enableInput(rfRun, 'random_forest_full_v1'))).replayed,
      false,
    );

    const other = setup();
    const stale = await scoreRun(other.store, { rf: 0.9 }, { scoredAt: new Date('2026-10-23Z') });
    await scoreRun(
      other.store,
      { rf: 0.95 },
      { scoredAt: new Date('2026-10-24Z'), policyHash: 'e'.repeat(64) },
    );
    await assert.rejects(other.enable.execute(enableInput(stale, 'random_forest_full_v1')), {
      code: 'OVERBOOKING_NOT_ELIGIBLE',
    });
    assert.equal(other.operations.inserts, 0);
  });

  it('dos POST concurrentes idénticos ⇒ un único registro; reintento devuelve la marca existente', async () => {
    const ctx = setup();
    const run = await scoreRun(ctx.store, { rf: 0.9, xgb: 0.95 });
    const results = await Promise.all([
      ctx.enable.execute(enableInput(run)),
      ctx.enable.execute(enableInput(run)),
    ]);
    assert.equal(ctx.operations.authorizationRows.length, 1);
    assert.deepEqual(
      results.map((r) => r.authorization.authorizationId),
      ['1', '1'],
    );
    assert.deepEqual(results.map((r) => r.replayed).sort(), [false, true]);
  });

  it('la marca guarda la predicción del momento: un score posterior no la reescribe', async () => {
    const ctx = setup();
    const run = await scoreRun(ctx.store, { xgb: 0.95 });
    const { authorization } = await ctx.enable.execute(enableInput(run));
    await scoreRun(
      ctx.store,
      { xgb: 0.2 },
      { scoredAt: new Date('2026-10-25Z'), policyHash: 'f'.repeat(64) },
    );
    const stored = ctx.operations.authorizationRows[0]!;
    assert.deepEqual(
      [
        stored.predictionRunId,
        stored.probabilityNoShowAtAuthorization,
        stored.riskBandAtAuthorization,
      ],
      [authorization.predictionRunId, 0.95, 'HIGH'],
    );
  });
});

describe('RecordAttendanceOutcome (HU-07)', () => {
  it('RF y XGB se contrastan por separado y pueden coincidir distinto (sin ensemble)', async () => {
    const ctx = setup();
    const run = await scoreRun(ctx.store, { rf: 0.49, xgb: 0.6 });
    ctx.clock.set(new Date('2026-11-12T21:00:00Z'));
    const { outcome } = await ctx.attendance.execute({
      reservationId: ID,
      clinicScope: ALL,
      attendanceStatus: 'NO_SHOW',
      predictionRunId: run,
      requestId: 'req-2',
    });
    assert.deepEqual(
      outcome.comparisons.map((c) => [c.modelKey, c.predictedNoShow, c.matchesPrediction]),
      [
        ['random_forest_full_v1', false, false],
        ['xgboost_full_v1', true, true],
      ],
    );
    assert.equal(outcome.sourceReservationStatus, 'SCHEDULED');
    assert.equal(outcome.appointmentEndAt?.toISOString(), '2026-11-12T20:40:00.000Z');
  });

  it('cita ya clasificada PAST por el ETL ⇒ registrable sin consultar la fuente; score posterior al inicio ⇒ 409', async () => {
    const ctx = setup();
    ctx.reservations.add(
      makeReservation({ status: 'PAST', appointmentAt: new Date('2026-10-20T20:00:00Z') }),
    );
    const early = await scoreRun(ctx.store, { rf: 0.7 }, { scoredAt: new Date('2026-10-19Z') });
    const loads = ctx.evidence.loads;
    const { outcome } = await ctx.attendance.execute({
      reservationId: ID,
      clinicScope: ALL,
      attendanceStatus: 'ATTENDED',
      predictionRunId: early,
      requestId: 'r',
    });
    assert.deepEqual(
      [outcome.sourceReservationStatus, outcome.comparisons[0]?.matchesPrediction],
      ['PAST', false],
    );
    assert.equal(ctx.evidence.loads, loads);

    const late = setup();
    late.reservations.add(
      makeReservation({ status: 'PAST', appointmentAt: new Date('2026-10-20T20:00:00Z') }),
    );
    const leaked = await scoreRun(late.store, { rf: 0.7 }, { scoredAt: new Date('2026-10-21Z') });
    await assert.rejects(
      late.attendance.execute({
        reservationId: ID,
        clinicScope: ALL,
        attendanceStatus: 'ATTENDED',
        predictionRunId: leaked,
        requestId: 'r',
      }),
      { code: 'PREDICTION_AFTER_APPOINTMENT' },
    );
    assert.equal(late.operations.inserts, 0);
  });

  it('alcance de sede: reserva de otra sede ⇒ 404 sin revelar su existencia', async () => {
    const ctx = setup(new Date('2026-11-13Z'));
    await assert.rejects(
      ctx.attendance.execute({
        reservationId: ID,
        clinicScope: { kind: 'CLINICS', clinicIds: [2] },
        attendanceStatus: 'NO_SHOW',
        predictionRunId: randomUUID(),
        requestId: 'r',
      }),
      { code: 'RESERVATION_NOT_FOUND' },
    );
  });
});

describe('RecordSpaceRecoveryOutcome (HU-08)', () => {
  it('true y false se guardan explícitos; concurrencia ⇒ un resultado; distinto ⇒ conflicto', async () => {
    const ctx = setup();
    const run = await scoreRun(ctx.store, { xgb: 0.95 });
    await ctx.enable.execute(enableInput(run));
    const input = { reservationId: ID, clinicScope: ALL, spaceRecovered: true, requestId: 'r' };
    const results = await Promise.all([ctx.recovery.execute(input), ctx.recovery.execute(input)]);
    assert.equal(ctx.operations.recoveryRows.length, 1);
    assert.deepEqual(results.map((r) => r.replayed).sort(), [false, true]);
    await assert.rejects(ctx.recovery.execute({ ...input, spaceRecovered: false }), {
      code: 'SPACE_RECOVERY_ALREADY_RECORDED_CONFLICT',
    });
    assert.equal(ctx.operations.recoveryRows[0]?.spaceRecovered, true);
    assert.equal(
      ctx.operations.recoveryRows[0]?.authorizationId,
      ctx.operations.authorizationRows[0]?.authorizationId,
    );
  });
});
