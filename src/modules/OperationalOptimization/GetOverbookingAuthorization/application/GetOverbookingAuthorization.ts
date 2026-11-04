import type { ReservationRepository } from '../../../Reservations/Shared/persistence/ReservationRepository.js';
import { loadAccessibleReservation } from '../../../ReservationRisk/Shared/access/LoadAccessibleReservation.js';
import type { OverbookingEligibilityResolver } from '../../Shared/access/OverbookingEligibilityResolver.js';
import type { OverbookingAuthorizationRepository } from '../../Shared/persistence/OverbookingAuthorizationRepository.js';
import type { GetOverbookingAuthorizationInput } from './input/GetOverbookingAuthorizationInput.js';
import type { GetOverbookingAuthorizationResult } from './result/GetOverbookingAuthorizationResult.js';

export interface GetOverbookingAuthorizationDependencies {
  readonly reservations: Pick<ReservationRepository, 'findById'>;
  readonly eligibility: OverbookingEligibilityResolver;
  readonly authorizations: Pick<OverbookingAuthorizationRepository, 'findByReservation'>;
}

/**
 * HU-06 CA1/CA3 (lectura pura): estado de la marca y elegibilidad calculada en el servidor para
 * que el FE muestre la acción solo cuando corresponde. Sin escrituras ni llamadas a Python.
 */
export class GetOverbookingAuthorization {
  constructor(private readonly deps: GetOverbookingAuthorizationDependencies) {}

  async execute(
    input: GetOverbookingAuthorizationInput,
  ): Promise<GetOverbookingAuthorizationResult> {
    const reservation = await loadAccessibleReservation(
      this.deps.reservations,
      input.reservationId,
      input.clinicScope,
    );
    const authorization = await this.deps.authorizations.findByReservation(
      reservation.reservationId,
    );
    const { eligibility } = await this.deps.eligibility.resolve(
      reservation,
      authorization !== null,
    );
    return { reservationId: reservation.reservationId, authorization, eligibility };
  }
}
