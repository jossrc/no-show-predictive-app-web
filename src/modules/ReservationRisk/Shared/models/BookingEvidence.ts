import type { SnapshotEvidenceSource } from '../../../../shared/data/DataSourceMode.js';
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
}

export type ServicesTemporalEvidence =
  'NONE_CURRENT_REPLICA' | 'CAPTURED_AT_BOOKING' | 'FLOWWW_UNCHANGED_BOOKING';

/** Versiones anteriores, vinculadas por DiaryGDelayedID; no son reservas independientes. */
export interface HistoricalBookingVersion {
  readonly reservationId: DecimalId;
  readonly originalReservationId: DecimalId;
  readonly appointmentAt: Date | null;
  readonly appointmentEndAt: Date | null;
  readonly scheduleChanged: boolean;
  readonly servicesChanged: boolean;
  readonly services: readonly {
    readonly sourceDetailId: DecimalId;
    readonly productId: DecimalId | null;
    readonly packId: DecimalId;
    readonly voucherId: DecimalId;
    readonly plannedSessionNumber: number;
  }[];
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
  readonly historicalVersions: readonly HistoricalBookingVersion[];
  readonly client: {
    readonly birthDate: string | null;
    readonly sex: string | null;
    readonly lastModifiedAt: Date | null;
  } | null;
  readonly services: readonly EvidenceServiceLine[];
  /**
   * FLOWWW_UNCHANGED_BOOKING: sin copias históricas ni eventos contradictorios, los servicios
   * siguen siendo los originales por la regla de FLOWww. No equivale a una captura fechada.
   * NONE_CURRENT_REPLICA: no se ha acreditado el estado al reservar.
   */
  readonly servicesTemporalEvidence: ServicesTemporalEvidence;
  readonly sourceIngestionBatchId: string | null;
  /** Procedencia: réplica real (VERIFIED_BOOKING_SNAPSHOT si se acredita) o fixture sintética. */
  readonly evidenceSource: SnapshotEvidenceSource;
}
