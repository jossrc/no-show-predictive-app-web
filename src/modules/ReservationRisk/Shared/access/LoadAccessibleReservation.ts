import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import {
  canAccessClinic,
  type ClinicAccessScope,
} from '../../../../shared/security/RequestPrincipal.js';
import { ReservationNotFoundException } from '../../../Reservations/Shared/errors/ReservationNotFoundException.js';
import type { Reservation } from '../../../Reservations/Shared/models/Reservation.js';
import type { ReservationRepository } from '../../../Reservations/Shared/persistence/ReservationRepository.js';

/**
 * Reserva inexistente y reserva fuera del alcance responden igual (404): no se revela la
 * existencia de recursos ajenos ni se consulta ninguna otra entidad.
 */
export async function loadAccessibleReservation(
  reservations: Pick<ReservationRepository, 'findById'>,
  reservationId: DecimalId,
  clinicScope: ClinicAccessScope,
): Promise<Reservation> {
  const reservation = await reservations.findById(reservationId);
  if (!reservation || !canAccessClinic(clinicScope, reservation.clinicId)) {
    throw new ReservationNotFoundException();
  }
  return reservation;
}
