import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { BookingEvidence } from '../models/BookingEvidence.js';

/** Lee de raw_flow/analytics (solo lectura) lo necesario para evaluar la foto de reserva. */
export interface BookingEvidenceSource {
  /**
   * Capacidad de la fuente: si sus líneas de servicio tienen evidencia temporal de la reserva.
   * La réplica actual (diary_det / appointment_services) no la tiene.
   */
  readonly servicesTemporalEvidence: 'NONE_CURRENT_REPLICA' | 'CAPTURED_AT_BOOKING';
  load(reservationId: DecimalId): Promise<BookingEvidence | null>;
}
