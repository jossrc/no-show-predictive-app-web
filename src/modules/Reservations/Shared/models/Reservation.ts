import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { ReservationStatus } from './ReservationStatus.js';

/** Hechos factuales de la reserva según la réplica actual (no instantánea de reserva). */
export interface Reservation {
  readonly reservationId: DecimalId;
  readonly clientId: DecimalId;
  readonly clinicId: number;
  readonly appointmentAt: Date;
  /** DiaryGCreated interpretado en America/Lima; null si la fuente no lo registra. */
  readonly bookingCreatedAt: Date | null;
  readonly status: ReservationStatus;
  /** classification_detail de la fuente; solo se expone para SCHEDULED/CANCELLED. */
  readonly sourceClassification: string | null;
  /** Existe evento RESCHEDULED: la foto original de reserva no es recuperable. */
  readonly hasRescheduleEvent: boolean;
  /** Momento en que el ETL clasificó la cita (la clasificación FUTURE es relativa a ese corte). */
  readonly classificationCutoffAt: Date | null;
}
