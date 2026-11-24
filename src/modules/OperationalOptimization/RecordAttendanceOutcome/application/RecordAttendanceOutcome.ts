import {
  allowedSnapshotEvidence,
  type DataSourceMode,
} from '../../../../shared/data/DataSourceMode.js';
import type { Clock } from '../../../../shared/time/Clock.js';
import type { ReservationRepository } from '../../../Reservations/Shared/persistence/ReservationRepository.js';
import type { ReservationScoreReader } from '../../../Reservations/Shared/persistence/ReservationScoreReader.js';
import { loadAccessibleReservation } from '../../../ReservationRisk/Shared/access/LoadAccessibleReservation.js';
import type { PredictionRunReader } from '../../../ReservationRisk/Shared/persistence/PredictionRunReader.js';
import type { AppointmentFinishedResolver } from '../../Shared/access/AppointmentFinishedResolver.js';
import { AppointmentNotFinishedException } from '../../Shared/errors/AppointmentNotFinishedException.js';
import { AttendanceAlreadyRecordedConflictException } from '../../Shared/errors/AttendanceAlreadyRecordedConflictException.js';
import { PredictionAfterAppointmentException } from '../../Shared/errors/PredictionAfterAppointmentException.js';
import { PredictionRequiredException } from '../../Shared/errors/PredictionRequiredException.js';
import { PredictionReservationMismatchException } from '../../Shared/errors/PredictionReservationMismatchException.js';
import { ReservationCancelledException } from '../../Shared/errors/ReservationCancelledException.js';
import type { AttendanceOutcome } from '../../Shared/models/OperationalRecords.js';
import type { AttendanceOutcomeRepository } from '../../Shared/persistence/AttendanceOutcomeRepository.js';
import { APPOINTMENT_FINISHED_RULE_VERSION } from '../../Shared/rules/AppointmentFinished.js';
import { compareWithObservedOutcome } from '../../Shared/rules/BinaryOutcomeComparison.js';
import type { RecordAttendanceOutcomeInput } from './input/RecordAttendanceOutcomeInput.js';
import type { RecordAttendanceOutcomeResult } from './result/RecordAttendanceOutcomeResult.js';

export interface RecordAttendanceOutcomeDependencies {
  readonly reservations: Pick<ReservationRepository, 'findById'>;
  readonly finished: AppointmentFinishedResolver;
  readonly scores: Pick<ReservationScoreReader, 'latestScores'>;
  readonly runs: PredictionRunReader;
  readonly outcomes: AttendanceOutcomeRepository;
  readonly mode: DataSourceMode;
  readonly clock: Clock;
}

function sameRequest(existing: AttendanceOutcome, input: RecordAttendanceOutcomeInput): boolean {
  return (
    existing.attendanceStatus === input.attendanceStatus &&
    existing.predictionRunId === input.predictionRunId
  );
}

/**
 * HU-07: registra la asistencia REAL (ATTENDED/NO_SHOW) de una cita finalizada y la contrasta,
 * modelo por modelo, con los scores YA persistidos del run indicado de esa misma reserva. Nunca
 * recalcula ni modifica la predicción ni llama a Python. Inmutable e idempotente por reserva.
 */
export class RecordAttendanceOutcome {
  constructor(private readonly deps: RecordAttendanceOutcomeDependencies) {}

  async execute(input: RecordAttendanceOutcomeInput): Promise<RecordAttendanceOutcomeResult> {
    const reservation = await loadAccessibleReservation(
      this.deps.reservations,
      input.reservationId,
      input.clinicScope,
    );

    const existing = await this.deps.outcomes.findByReservation(reservation.reservationId);
    if (existing) return this.replayOrConflict(existing, input);

    const { assessment, appointmentEndAt } = await this.deps.finished.resolve(reservation);
    if (!assessment.finished) {
      if (assessment.code === 'RESERVATION_CANCELLED') throw new ReservationCancelledException();
      throw new AppointmentNotFinishedException(assessment.code);
    }

    const evidence = allowedSnapshotEvidence(this.deps.mode);
    const results = await this.deps.runs.findRunResults(
      reservation.reservationId,
      input.predictionRunId,
      evidence,
    );
    if (results.length === 0) {
      const latest = await this.deps.scores.latestScores([reservation.reservationId], evidence);
      if ((latest.get(reservation.reservationId) ?? []).length === 0) {
        throw new PredictionRequiredException();
      }
      throw new PredictionReservationMismatchException();
    }
    // Sin fuga temporal: solo se contrastan scores obtenidos antes del inicio de la cita.
    if (results.some((score) => score.scoredAt.getTime() > reservation.appointmentAt.getTime())) {
      throw new PredictionAfterAppointmentException();
    }

    const observedNoShow = input.attendanceStatus === 'NO_SHOW';
    const outcome = await this.deps.outcomes.insertIfAbsent({
      reservationId: reservation.reservationId,
      clinicId: reservation.clinicId,
      appointmentAt: reservation.appointmentAt,
      appointmentEndAt,
      sourceReservationStatus: assessment.sourceStatus,
      attendanceStatus: input.attendanceStatus,
      observedNoShow,
      recordedAt: this.deps.clock.now(),
      requestId: input.requestId,
      actorKind: 'INTERNAL_SERVICE',
      actorUserId: null,
      predictionRunId: input.predictionRunId,
      finishedRuleVersion: APPOINTMENT_FINISHED_RULE_VERSION,
      comparisons: results.map((score) => ({
        predictionResultId: score.resultId,
        modelKey: score.modelKey,
        modelVersion: score.modelVersion,
        probabilityNoShow: score.probabilityNoShow,
        scoredAt: score.scoredAt,
        experimentalRiskLevel: score.experimentalRisk?.level ?? null,
        researchPolicyHash: score.experimentalRisk?.policyHash ?? null,
        ...compareWithObservedOutcome(score.probabilityNoShow, observedNoShow),
      })),
    });
    if (!outcome.created) return this.replayOrConflict(outcome.record, input);
    return { outcome: outcome.record, replayed: false };
  }

  private replayOrConflict(
    existing: AttendanceOutcome,
    input: RecordAttendanceOutcomeInput,
  ): RecordAttendanceOutcomeResult {
    if (!sameRequest(existing, input)) {
      throw new AttendanceAlreadyRecordedConflictException({
        attendanceStatus: existing.attendanceStatus,
        predictionRunId: existing.predictionRunId,
      });
    }
    return { outcome: existing, replayed: true };
  }
}
