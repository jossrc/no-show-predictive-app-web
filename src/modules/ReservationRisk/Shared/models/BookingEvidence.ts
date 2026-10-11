import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { ReservationStatus } from '../../../Reservations/Shared/models/ReservationStatus.js';
import type { ScheduledServiceLine } from './VerifiedBookingSnapshot.js';

/**
 * Lo que la réplica raw_flow/analytics permite saber HOY sobre la reserva, con las marcas
 * temporales necesarias para decidir si representa la foto al reservar.
 */
export interface EvidenceServiceLine extends ScheduledServiceLine {
  readonly productFound: boolean;
  readonly catalogResolved: boolean;
  /** Última modificación conocida de cada fila de catálogo implicada (null = desconocida). */
  readonly catalogLastModifiedAt: readonly (Date | null)[];
}

export interface BookingEvidence {
  readonly reservationId: DecimalId;
  readonly clientId: DecimalId;
  readonly clinicId: number;
  readonly reservationStatus: ReservationStatus;
  readonly bookingCreatedAt: Date | null;
  readonly appointmentAt: Date;
  readonly appointmentEndAt: Date | null;
  readonly fwaFlag: number | null;
  readonly hasRescheduleEvent: boolean;
  readonly client: {
    readonly birthDate: string | null;
    readonly sex: string | null;
    readonly lastModifiedAt: Date | null;
  } | null;
  readonly services: readonly EvidenceServiceLine[];
  /**
   * NONE_CURRENT_REPLICA: diary_det/appointment_services no guardan cuándo se creó cada línea;
   * solo hay estado replicado actual. CAPTURED_AT_BOOKING requeriría una captura fechada.
   */
  readonly servicesTemporalEvidence: 'NONE_CURRENT_REPLICA' | 'CAPTURED_AT_BOOKING';
  readonly sourceIngestionBatchId: string | null;
}
