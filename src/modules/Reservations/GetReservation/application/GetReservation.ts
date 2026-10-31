import {
  allowedSnapshotEvidence,
  type DataSourceMode,
} from '../../../../shared/data/DataSourceMode.js';
import { canAccessClinic } from '../../../../shared/security/RequestPrincipal.js';
import type { Clock } from '../../../../shared/time/Clock.js';
import { ReservationNotFoundException } from '../../Shared/errors/ReservationNotFoundException.js';
import type { ReservationRepository } from '../../Shared/persistence/ReservationRepository.js';
import type { GetReservationInput } from './input/GetReservationInput.js';
import type { GetReservationResult } from './result/GetReservationResult.js';

/** HU-01/02: detalle factual de la reserva y metadatos de scores persistidos, sin inventar riesgo. */
export class GetReservation {
  constructor(
    private readonly reservations: Pick<ReservationRepository, 'findWithScores'>,
    private readonly clock: Clock,
    private readonly mode: DataSourceMode,
  ) {}

  async execute(input: GetReservationInput): Promise<GetReservationResult> {
    const found = await this.reservations.findWithScores(
      input.reservationId,
      allowedSnapshotEvidence(this.mode),
    );
    if (!found || !canAccessClinic(input.clinicScope, found.reservation.clinicId)) {
      throw new ReservationNotFoundException();
    }

    const { reservation } = found;
    const stale =
      reservation.status === 'SCHEDULED' &&
      reservation.appointmentAt.getTime() <= this.clock.now().getTime();

    return {
      reservation,
      sourceFreshness: stale ? 'STALE_CLASSIFICATION' : 'CURRENT',
      scores: found.scores,
      hasUsableSnapshot: found.hasUsableSnapshot,
      sourceStatus: this.mode,
    };
  }
}
