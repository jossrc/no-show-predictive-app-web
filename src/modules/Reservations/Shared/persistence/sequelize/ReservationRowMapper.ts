import type { Reservation } from '../../models/Reservation.js';
import { deriveReservationStatus } from '../../models/ReservationStatus.js';

export interface ReservationRow {
  reservation_id: string;
  client_id: string;
  clinic_id: number;
  appointment_at: Date;
  created_at_source: Date | null;
  outcome: string;
  classification_detail: string | null;
  classification_cutoff_at: Date | null;
  has_reschedule_event: boolean;
}

/** Devuelve null si la fila no es una reserva (borrador, copia de reprogramación, bloqueo…). */
export function mapReservationRow(row: ReservationRow): Reservation | null {
  const status = deriveReservationStatus(row.outcome, row.classification_detail);
  if (status === null) return null;

  return {
    reservationId: row.reservation_id,
    clientId: row.client_id,
    clinicId: Number(row.clinic_id),
    appointmentAt: row.appointment_at,
    bookingCreatedAt: row.created_at_source,
    status,
    sourceClassification: status === 'PAST' ? null : row.classification_detail,
    hasRescheduleEvent: row.has_reschedule_event === true,
    classificationCutoffAt: row.classification_cutoff_at,
  };
}
