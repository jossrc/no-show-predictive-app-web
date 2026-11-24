import type { Reservation } from '../../../Reservations/Shared/models/Reservation.js';

/**
 * Regla `appointment_finished_rule_v1` (HU-07). Una cita se considera FINALIZADA solo con
 * evidencia de la fuente, nunca por suposición:
 * - CANCELLED ⇒ no se registra asistencia (una cancelación no es inasistencia);
 * - inicio de la cita aún no alcanzado (Clock) ⇒ no finalizada;
 * - PAST (el ETL ya la clasificó como pasada) ⇒ finalizada;
 * - SCHEDULED con clasificación ETL desactualizada ⇒ finalizada solo si el fin programado de la
 *   cita en FLOWww (DiaryGDate + DiaryGEnd, hora de Lima) ya pasó; sin fin conocido no se
 *   inventa que terminó.
 */
export const APPOINTMENT_FINISHED_RULE_VERSION = 'appointment_finished_rule_v1';

export const APPOINTMENT_NOT_FINISHED_MESSAGES = {
  RESERVATION_CANCELLED: 'La reserva está cancelada: no se registra asistencia',
  APPOINTMENT_NOT_STARTED: 'La cita todavía no ha comenzado',
  APPOINTMENT_IN_PROGRESS: 'La cita aún no termina según su horario programado',
  APPOINTMENT_END_UNKNOWN:
    'La fuente no acredita la hora de término de la cita ni la clasifica como pasada',
} as const;

export type AppointmentNotFinishedCode = keyof typeof APPOINTMENT_NOT_FINISHED_MESSAGES;

export type AppointmentFinishedAssessment =
  | { readonly finished: true; readonly sourceStatus: 'SCHEDULED' | 'PAST' }
  | { readonly finished: false; readonly code: AppointmentNotFinishedCode };

/** `appointmentEndAt` solo se consulta para SCHEDULED con inicio vencido (evita lecturas). */
export async function assessAppointmentFinished(
  reservation: Reservation,
  now: Date,
  appointmentEndAt: () => Promise<Date | null>,
): Promise<AppointmentFinishedAssessment> {
  if (reservation.status === 'CANCELLED') return { finished: false, code: 'RESERVATION_CANCELLED' };
  if (reservation.appointmentAt.getTime() >= now.getTime()) {
    return { finished: false, code: 'APPOINTMENT_NOT_STARTED' };
  }
  if (reservation.status === 'PAST') return { finished: true, sourceStatus: 'PAST' };

  const end = await appointmentEndAt();
  if (end === null) return { finished: false, code: 'APPOINTMENT_END_UNKNOWN' };
  if (end.getTime() > now.getTime()) return { finished: false, code: 'APPOINTMENT_IN_PROGRESS' };
  return { finished: true, sourceStatus: 'SCHEDULED' };
}
