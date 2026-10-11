import type { Reservation } from '../models/Reservation.js';
import type { ReservationScoreSummary } from '../models/ReservationScoreSummary.js';

export interface ReservationBody {
  reservationId: string;
  clientId: string;
  clinicId: number;
  appointmentAt: string;
  bookingCreatedAt: string | null;
  reservationStatus: Reservation['status'];
  sourceClassification: string | null;
  hasRescheduleEvent: boolean;
  classificationCutoffAt: string | null;
  sourceFreshness: 'CURRENT' | 'STALE_CLASSIFICATION';
}

export interface ScoreSummaryBody {
  modelKey: string;
  modelVersion: string;
  modelHash: string;
  probabilityNoShow: number;
  /** 100·p solo para visualización; la probabilidad original no se redondea. */
  percentageNoShow: number;
  scoredAt: string;
  predictionRunId: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | null;
}

export function toReservationBody(
  reservation: Reservation,
  sourceFreshness: ReservationBody['sourceFreshness'],
): ReservationBody {
  return {
    reservationId: reservation.reservationId,
    clientId: reservation.clientId,
    clinicId: reservation.clinicId,
    appointmentAt: reservation.appointmentAt.toISOString(),
    bookingCreatedAt: reservation.bookingCreatedAt?.toISOString() ?? null,
    reservationStatus: reservation.status,
    sourceClassification: reservation.sourceClassification,
    hasRescheduleEvent: reservation.hasRescheduleEvent,
    classificationCutoffAt: reservation.classificationCutoffAt?.toISOString() ?? null,
    sourceFreshness,
  };
}

export function toScoreSummaryBody(
  score: ReservationScoreSummary,
  riskLevel: ScoreSummaryBody['riskLevel'] = null,
): ScoreSummaryBody {
  return {
    modelKey: score.modelKey,
    modelVersion: score.modelVersion,
    modelHash: score.modelHash,
    probabilityNoShow: score.probabilityNoShow,
    percentageNoShow: score.probabilityNoShow * 100,
    scoredAt: score.scoredAt.toISOString(),
    predictionRunId: score.predictionRunId,
    riskLevel,
  };
}
