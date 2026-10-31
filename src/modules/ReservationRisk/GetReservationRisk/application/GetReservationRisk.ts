import type { DataSourceMode } from '../../../../shared/data/DataSourceMode.js';
import type { Clock } from '../../../../shared/time/Clock.js';
import type { ReservationRepository } from '../../../Reservations/Shared/persistence/ReservationRepository.js';
import { loadAccessibleReservation } from '../../Shared/access/LoadAccessibleReservation.js';
import { assembleRiskAssessment } from '../../Shared/calculation/AssembleRiskAssessment.js';
import type { BookingSnapshotResolver } from '../../Shared/calculation/BookingSnapshotResolver.js';
import type { PredictionResultRepository } from '../../Shared/persistence/PredictionResultRepository.js';
import type { RiskLevelPolicy } from '../../Shared/policy/RiskLevelPolicy.js';
import type { GetReservationRiskInput } from './input/GetReservationRiskInput.js';
import type { GetReservationRiskResult } from './result/GetReservationRiskResult.js';

export interface GetReservationRiskDependencies {
  readonly reservations: Pick<ReservationRepository, 'findById'>;
  readonly snapshots: BookingSnapshotResolver;
  readonly results: Pick<PredictionResultRepository, 'findLatestBySnapshot'>;
  readonly policy: RiskLevelPolicy;
  readonly mode: DataSourceMode;
  readonly clock: Clock;
}

/**
 * HU-02 (lectura): devuelve scores YA persistidos con su identidad. Nunca llama a Python ni
 * crea snapshots/predicciones: un GET no tiene efectos secundarios (sin HU-04 encubierta).
 */
export class GetReservationRisk {
  constructor(private readonly deps: GetReservationRiskDependencies) {}

  async execute(input: GetReservationRiskInput): Promise<GetReservationRiskResult> {
    const reservation = await loadAccessibleReservation(
      this.deps.reservations,
      input.reservationId,
      input.clinicScope,
    );
    const resolution = await this.deps.snapshots.resolve(reservation);

    const snapshot = resolution.kind === 'STORED' ? resolution.snapshot : null;
    const scores = snapshot
      ? await this.deps.results.findLatestBySnapshot(snapshot.snapshotId)
      : [];
    const reasons = resolution.kind === 'NOT_SCORABLE' ? resolution.reasons : [];

    const stale =
      reservation.status === 'SCHEDULED' &&
      reservation.appointmentAt.getTime() <= this.deps.clock.now().getTime();

    return {
      reservation,
      assessment: assembleRiskAssessment({
        reservationId: reservation.reservationId,
        snapshot,
        scores,
        reasons,
        policy: this.deps.policy,
        mode: this.deps.mode,
      }),
      sourceFreshness: stale ? 'STALE_CLASSIFICATION' : 'CURRENT',
    };
  }
}
