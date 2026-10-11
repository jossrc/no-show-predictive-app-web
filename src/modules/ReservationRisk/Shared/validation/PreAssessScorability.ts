import type { DataSourceMode } from '../../../../shared/data/DataSourceMode.js';
import type { Reservation } from '../../../Reservations/Shared/models/Reservation.js';
import {
  notScorableReason,
  type NotScorableReason,
  type NotScorableReasonCode,
} from '../models/NotScorableReason.js';
import type { BookingEvidenceSource } from '../persistence/BookingEvidenceSource.js';

export type PredictionAvailability = 'AVAILABLE_EXPLORATORY' | 'NOT_SCORED' | 'NOT_SCORABLE';

export interface ScorabilityPreAssessment {
  readonly availability: PredictionAvailability;
  readonly reasons: readonly NotScorableReason[];
}

/**
 * Clasificación barata para el listado (sin consultas extra por fila): usa solo hechos ya
 * leídos. El detalle /risk aplica la evaluación completa de evidencia.
 */
export function preAssessScorability(
  reservation: Reservation,
  facts: { hasScores: boolean; hasUsableSnapshot: boolean },
  context: {
    mode: DataSourceMode;
    servicesTemporalEvidence: BookingEvidenceSource['servicesTemporalEvidence'];
  },
): ScorabilityPreAssessment {
  if (facts.hasScores) return { availability: 'AVAILABLE_EXPLORATORY', reasons: [] };
  if (facts.hasUsableSnapshot) return { availability: 'NOT_SCORED', reasons: [] };

  const codes: NotScorableReasonCode[] = [];
  if (reservation.status !== 'SCHEDULED') codes.push('RESERVATION_NOT_SCHEDULED');

  if (context.mode === 'SYNTHETIC_DEMO_ONLY') {
    codes.push('NO_USABLE_SNAPSHOT_IN_MODE');
  } else {
    if (reservation.bookingCreatedAt === null) codes.push('MISSING_BOOKING_TIME');
    if (reservation.hasRescheduleEvent) codes.push('RESCHEDULED_WITHOUT_ORIGINAL_SNAPSHOT');
    if (context.servicesTemporalEvidence !== 'CAPTURED_AT_BOOKING') {
      codes.push('SCHEDULED_SERVICES_NOT_POINT_IN_TIME');
    }
  }

  return codes.length > 0
    ? { availability: 'NOT_SCORABLE', reasons: codes.map(notScorableReason) }
    : { availability: 'NOT_SCORED', reasons: [] };
}
