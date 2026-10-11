/**
 * Estado visible de una reserva, derivado de analytics.appointment_outcomes (FLOW_NO_SHOW_V1).
 * - SCHEDULED: outcome FUTURE / FUTURE_PENDING (programada, sin cancelación).
 * - CANCELLED: FUTURE_CANCELLED (futura con marca de cancelación; no es no-show).
 * - PAST: cita ya clasificada como pasada; su resultado final NO se expone en Sprint 01.
 * Borradores (tag 16), copias de reprogramación, bloqueos e ignorados no son reservas.
 */
export const LISTABLE_RESERVATION_STATUSES = ['SCHEDULED', 'CANCELLED'] as const;

export type ListableReservationStatus = (typeof LISTABLE_RESERVATION_STATUSES)[number];

export type ReservationStatus = ListableReservationStatus | 'PAST';

const NON_RESERVATION_OUTCOMES = new Set(['RESCHEDULED_HISTORY', 'DRAFT', 'BLOCKED', 'IGNORED']);

export function deriveReservationStatus(
  outcome: string,
  classificationDetail: string | null,
): ReservationStatus | null {
  if (NON_RESERVATION_OUTCOMES.has(outcome)) return null;
  if (outcome === 'FUTURE') return 'SCHEDULED';
  if (classificationDetail === 'FUTURE_CANCELLED') return 'CANCELLED';
  return 'PAST';
}
