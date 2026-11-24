import type { Reservation } from '../../../Reservations/Shared/models/Reservation.js';
import type { ReservationScoreSummary } from '../../../Reservations/Shared/models/ReservationScoreSummary.js';
import { isWithinRetentionWindow, type RetentionWindow } from './RetentionWindow.js';

/**
 * Regla `retention_priority_v1`. Una reserva es prioritaria para retención con el modelo elegido
 * si, simultáneamente: está programada (SCHEDULED); su cita es futura y cae en la ventana móvil
 * de 72 h; y el ÚLTIMO score persistido de ESE modelo tiene banda experimental HIGH bajo la
 * política research vigente del modelo. No usa `riskLevel` operativo (null), no define umbrales,
 * no combina RF/XGB ni elige el modelo con mayor probabilidad: el modelo lo elige el consumidor.
 */
export const RETENTION_ELIGIBILITY_RULE_VERSION = 'retention_priority_v1';

export const RETENTION_INELIGIBILITY_MESSAGES = {
  RESERVATION_NOT_SCHEDULED: 'La reserva no está programada (cancelada o pasada)',
  APPOINTMENT_NOT_FUTURE: 'La cita ya comenzó o pasó',
  APPOINTMENT_OUTSIDE_RETENTION_WINDOW: 'La cita no está dentro de las próximas 72 horas',
  NOT_SCORED: 'La reserva no tiene una estimación persistida del modelo elegido',
  PREDICTION_NOT_LATEST:
    'La predicción indicada no es la última del modelo para esta reserva; vuelva a consultar',
  EXPERIMENTAL_BAND_UNAVAILABLE: 'La estimación no tiene banda experimental research v2',
  PREDICTION_NOT_HIGH: 'La banda experimental de la estimación no es Alta',
  RESEARCH_POLICY_NOT_CURRENT: 'La estimación usa una política research que ya no es la vigente',
} as const;

export type RetentionIneligibilityCode = keyof typeof RETENTION_INELIGIBILITY_MESSAGES;

export interface RetentionIneligibilityReason {
  readonly code: RetentionIneligibilityCode;
  readonly message: string;
}

export function retentionIneligibility(
  code: RetentionIneligibilityCode,
): RetentionIneligibilityReason {
  return { code, message: RETENTION_INELIGIBILITY_MESSAGES[code] };
}

export interface RetentionEligibilityInput {
  readonly reservation: Reservation;
  readonly window: RetentionWindow;
  /** Último score del modelo elegido para la reserva (evidencia del modo activo). */
  readonly latestScore: ReservationScoreSummary | null;
  /** Hash de la política research vigente del modelo (null si no hay ninguna). */
  readonly currentPolicyHash: string | null;
  /** Predicción que el consumidor declara como sustento; null = la última. */
  readonly predictionRunId: string | null;
}

export function evaluateRetentionEligibility(
  input: RetentionEligibilityInput,
): RetentionIneligibilityReason[] {
  const reasons: RetentionIneligibilityReason[] = [];
  const { reservation, window, latestScore } = input;
  if (reservation.status !== 'SCHEDULED') {
    reasons.push(retentionIneligibility('RESERVATION_NOT_SCHEDULED'));
  }
  if (reservation.appointmentAt.getTime() <= window.startExclusive.getTime()) {
    reasons.push(retentionIneligibility('APPOINTMENT_NOT_FUTURE'));
  } else if (!isWithinRetentionWindow(reservation.appointmentAt, window)) {
    reasons.push(retentionIneligibility('APPOINTMENT_OUTSIDE_RETENTION_WINDOW'));
  }
  if (!latestScore) {
    reasons.push(retentionIneligibility('NOT_SCORED'));
    return reasons;
  }
  if (input.predictionRunId !== null && latestScore.predictionRunId !== input.predictionRunId) {
    reasons.push(retentionIneligibility('PREDICTION_NOT_LATEST'));
  }
  const risk = latestScore.experimentalRisk;
  if (!risk) {
    reasons.push(retentionIneligibility('EXPERIMENTAL_BAND_UNAVAILABLE'));
    return reasons;
  }
  if (risk.level !== 'HIGH') reasons.push(retentionIneligibility('PREDICTION_NOT_HIGH'));
  if (input.currentPolicyHash === null || risk.policyHash !== input.currentPolicyHash) {
    reasons.push(retentionIneligibility('RESEARCH_POLICY_NOT_CURRENT'));
  }
  return reasons;
}
