/**
 * Contexto compartido de la suite mínima del Sprint 02 (HU-06, HU-07, HU-08). Ensambla los casos
 * de uso REALES con los dobles existentes de tests/helpers (almacenes en memoria, reloj fijo y
 * evidencia sintética). Sin BD, sin red y sin servicio ML: las predicciones se construyen a partir
 * de los goldens sintéticos del contrato v2. Cada llamada a setupSprint02() crea un contexto
 * nuevo, de modo que las pruebas no comparten estado.
 */
import { randomUUID } from 'node:crypto';
import type { MlResearchPredictionResponse } from '../../../../src/infrastructure/http/ml/MlContractTypes.js';
import { EXPERIMENTAL_RISK_LABELS } from '../../../../src/infrastructure/http/ml/MlResearchContractSchemas.js';
import { bandImpliedByContract } from '../../../../src/infrastructure/http/ml/MlResearchContractValidator.js';
import { EnableOverbooking } from '../../../../src/modules/OperationalOptimization/EnableOverbooking/application/EnableOverbooking.js';
import { GetSpaceRecoveryOutcome } from '../../../../src/modules/OperationalOptimization/GetSpaceRecoveryOutcome/application/GetSpaceRecoveryOutcome.js';
import { RecordAttendanceOutcome } from '../../../../src/modules/OperationalOptimization/RecordAttendanceOutcome/application/RecordAttendanceOutcome.js';
import { RecordSpaceRecoveryOutcome } from '../../../../src/modules/OperationalOptimization/RecordSpaceRecoveryOutcome/application/RecordSpaceRecoveryOutcome.js';
import { AppointmentFinishedResolver } from '../../../../src/modules/OperationalOptimization/Shared/access/AppointmentFinishedResolver.js';
import { OverbookingEligibilityResolver } from '../../../../src/modules/OperationalOptimization/Shared/access/OverbookingEligibilityResolver.js';
import { toNewModelScore } from '../../../../src/modules/ReservationRisk/Shared/calculation/ToNewModelScore.js';
import { PendingValidationRiskLevelPolicy } from '../../../../src/modules/ReservationRisk/Shared/policy/PendingValidationRiskLevelPolicy.js';
import { FakeBookingEvidenceSource } from '../../../helpers/FakeBookingEvidenceSource.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { InMemoryOperationalStore } from '../../../helpers/InMemoryOperationalStore.js';
import { InMemoryPredictiveStore } from '../../../helpers/InMemoryPredictiveStore.js';
import { InMemoryReservationRepository } from '../../../helpers/InMemoryReservationRepository.js';
import { loadMlGolden } from '../../../helpers/LoadFixture.js';
import {
  makeBookingEvidence,
  makeReservation,
  makeStoredSnapshot,
  makeVerifiedSnapshot,
  SYNTHETIC_RESERVATION_ID,
} from '../../../helpers/MakeSyntheticReservation.js';

export { SYNTHETIC_RESERVATION_ID as RESERVATION_ID };

export const ALL_CLINICS = { kind: 'ALL_CLINICS' } as const;

/** Cita sintética: inicio 2026-11-12T20:00Z, fin programado 2026-11-12T20:40Z. */
export const BEFORE_APPOINTMENT = new Date('2026-10-25T15:00:00.000Z');
export const DURING_APPOINTMENT = new Date('2026-11-12T20:20:00.000Z');
export const AFTER_APPOINTMENT_END = new Date('2026-11-12T21:00:00.000Z');

export type ModelAlias = 'rf' | 'xgb';
export type ModelKey = 'random_forest_full_v1' | 'xgboost_full_v1';

const policy = new PendingValidationRiskLevelPolicy();

export function setupSprint02(now: Date = BEFORE_APPOINTMENT) {
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
  const getRecovery = new GetSpaceRecoveryOutcome({
    reservations,
    authorizations: operations.authorizations,
    recoveries: operations.recoveries,
  });
  return {
    store,
    operations,
    reservations,
    clock,
    eligibility,
    enable,
    attendance,
    recovery,
    getRecovery,
  };
}

/**
 * Persiste un run de predicción (contrato v2) con las probabilidades indicadas por modelo. La banda
 * experimental se deriva de los umbrales del golden, igual que la validación del contrato real.
 */
export async function scoreRun(
  store: InMemoryPredictiveStore,
  probabilities: Partial<Record<ModelAlias, number>>,
  options: { scoredAt?: Date; reservationId?: string } = {},
): Promise<string> {
  const reservationId = options.reservationId ?? SYNTHETIC_RESERVATION_ID;
  const {
    snapshotId: _snapshotId,
    createdAt: _createdAt,
    ...rest
  } = makeStoredSnapshot({ verified: makeVerifiedSnapshot({ reservationId }) });
  const snapshot = await store.saveIfAbsent({
    ...rest,
    evidence: {},
    sourceIngestionBatchId: null,
  });
  const runUid = randomUUID();
  const scores = (Object.entries(probabilities) as Array<[ModelAlias, number]>).map(
    ([model, probability]) => {
      const golden = loadMlGolden<MlResearchPredictionResponse>(`golden_v2_predict_${model}`);
      const level = bandImpliedByContract(probability, golden.experimental_risk);
      const response: MlResearchPredictionResponse = {
        ...golden,
        probability_no_show: probability,
        experimental_risk: {
          ...golden.experimental_risk,
          level,
          label: EXPERIMENTAL_RISK_LABELS[level],
        },
      };
      return toNewModelScore(
        response,
        snapshot,
        options.scoredAt ?? new Date('2026-10-24T00:00:00.000Z'),
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
      requestedModelKeys: scores.map((score) => score.modelKey),
      requestId: 'sprint2-unit',
      runRequestedAt: new Date('2026-10-24T00:00:00.000Z'),
      completedAt: new Date('2026-10-24T00:00:00.000Z'),
      mlLatencyMs: 1,
      scoringApiVersion: 'v2',
    },
    scores,
  );
  return runUid;
}

export function enableInput(predictionRunId: string, modelKey: ModelKey = 'xgboost_full_v1') {
  return {
    reservationId: SYNTHETIC_RESERVATION_ID,
    clinicScope: ALL_CLINICS,
    modelKey,
    predictionRunId,
    requestId: 'sprint2-enable',
  };
}
