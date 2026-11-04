import {
  allowedSnapshotEvidence,
  type DataSourceMode,
} from '../../../../shared/data/DataSourceMode.js';
import type { ReservationRepository } from '../../../Reservations/Shared/persistence/ReservationRepository.js';
import type { ReservationScoreReader } from '../../../Reservations/Shared/persistence/ReservationScoreReader.js';
import { loadAccessibleReservation } from '../../../ReservationRisk/Shared/access/LoadAccessibleReservation.js';
import type { AppointmentFinishedResolver } from '../../Shared/access/AppointmentFinishedResolver.js';
import type { AttendanceOutcomeRepository } from '../../Shared/persistence/AttendanceOutcomeRepository.js';
import { APPOINTMENT_FINISHED_RULE_VERSION } from '../../Shared/rules/AppointmentFinished.js';
import type { GetAttendanceOutcomeInput } from './input/GetAttendanceOutcomeInput.js';
import type {
  AttendanceRegistrationBlocker,
  GetAttendanceOutcomeResult,
} from './result/GetAttendanceOutcomeResult.js';

export interface GetAttendanceOutcomeDependencies {
  readonly reservations: Pick<ReservationRepository, 'findById'>;
  readonly finished: AppointmentFinishedResolver;
  readonly scores: Pick<ReservationScoreReader, 'latestScores'>;
  readonly outcomes: Pick<AttendanceOutcomeRepository, 'findByReservation'>;
  readonly mode: DataSourceMode;
}

/**
 * HU-07 CA3 (lectura pura): resultado observado con sus comparaciones guardadas por modelo y, si
 * aún no existe, si la cita admite registro. No recalcula comparaciones ni llama a Python.
 */
export class GetAttendanceOutcome {
  constructor(private readonly deps: GetAttendanceOutcomeDependencies) {}

  async execute(input: GetAttendanceOutcomeInput): Promise<GetAttendanceOutcomeResult> {
    const reservation = await loadAccessibleReservation(
      this.deps.reservations,
      input.reservationId,
      input.clinicScope,
    );
    const outcome = await this.deps.outcomes.findByReservation(reservation.reservationId);
    const latest = await this.deps.scores.latestScores(
      [reservation.reservationId],
      allowedSnapshotEvidence(this.deps.mode),
    );
    const availablePredictionRunIds = [
      ...new Set((latest.get(reservation.reservationId) ?? []).map((s) => s.predictionRunId)),
    ];

    let blocker: AttendanceRegistrationBlocker | null = null;
    if (outcome) blocker = 'ALREADY_RECORDED';
    else {
      const { assessment } = await this.deps.finished.resolve(reservation);
      if (!assessment.finished) blocker = assessment.code;
      else if (availablePredictionRunIds.length === 0) blocker = 'PREDICTION_REQUIRED';
    }

    return {
      reservationId: reservation.reservationId,
      outcome,
      registration: {
        ruleVersion: APPOINTMENT_FINISHED_RULE_VERSION,
        registrable: blocker === null,
        blocker,
        availablePredictionRunIds,
      },
    };
  }
}
