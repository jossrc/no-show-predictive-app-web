import type { ReservationRepository } from '../../../Reservations/Shared/persistence/ReservationRepository.js';
import { loadAccessibleReservation } from '../../../ReservationRisk/Shared/access/LoadAccessibleReservation.js';
import type { OverbookingAuthorizationRepository } from '../../Shared/persistence/OverbookingAuthorizationRepository.js';
import type { SpaceRecoveryOutcomeRepository } from '../../Shared/persistence/SpaceRecoveryOutcomeRepository.js';
import type { GetSpaceRecoveryOutcomeInput } from './input/GetSpaceRecoveryOutcomeInput.js';
import type { GetSpaceRecoveryOutcomeResult } from './result/GetSpaceRecoveryOutcomeResult.js';

export interface GetSpaceRecoveryOutcomeDependencies {
  readonly reservations: Pick<ReservationRepository, 'findById'>;
  readonly authorizations: Pick<OverbookingAuthorizationRepository, 'findByReservation'>;
  readonly recoveries: Pick<SpaceRecoveryOutcomeRepository, 'findByReservation'>;
}

/** HU-08 (lectura pura): resultado de recuperación y vínculo con la gestión HU-06. */
export class GetSpaceRecoveryOutcome {
  constructor(private readonly deps: GetSpaceRecoveryOutcomeDependencies) {}

  async execute(input: GetSpaceRecoveryOutcomeInput): Promise<GetSpaceRecoveryOutcomeResult> {
    const reservation = await loadAccessibleReservation(
      this.deps.reservations,
      input.reservationId,
      input.clinicScope,
    );
    const [authorization, outcome] = await Promise.all([
      this.deps.authorizations.findByReservation(reservation.reservationId),
      this.deps.recoveries.findByReservation(reservation.reservationId),
    ]);
    return { reservationId: reservation.reservationId, authorization, outcome };
  }
}
