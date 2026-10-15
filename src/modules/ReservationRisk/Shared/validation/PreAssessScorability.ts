import {
  allowedSnapshotEvidence,
  type DataSourceMode,
  type SnapshotEvidenceSource,
} from '../../../../shared/data/DataSourceMode.js';
import type { Reservation } from '../../../Reservations/Shared/models/Reservation.js';
import {
  notScorableReason,
  type NotScorableReason,
  type NotScorableReasonCode,
} from '../models/NotScorableReason.js';

export type PredictionAvailability = 'AVAILABLE_EXPLORATORY' | 'NOT_SCORED' | 'NOT_SCORABLE';

export interface ScorabilityPreAssessment {
  readonly availability: PredictionAvailability;
  readonly reasons: readonly NotScorableReason[];
}

/**
 * Clasificación barata para el listado (sin consultas extra por fila): usa solo hechos ya
 * leídos. En réplica real, una reprogramación no se declara NOT_SCORABLE por sí sola: las copias
 * FLOWww pueden reconstruir la reserva original en /risk. En SYNTHETIC_DEMO_ONLY no hay esas
 * copias: hasRescheduleEvent implica ausencia de instantánea original. Sin score no se marca
 * AVAILABLE.
 */
export function preAssessScorability(
  reservation: Reservation,
  facts: { hasScores: boolean; hasUsableSnapshot: boolean },
  context: {
    mode: DataSourceMode;
    snapshotEvidenceSource: SnapshotEvidenceSource;
  },
): ScorabilityPreAssessment {
  if (facts.hasScores) return { availability: 'AVAILABLE_EXPLORATORY', reasons: [] };
  if (facts.hasUsableSnapshot) return { availability: 'NOT_SCORED', reasons: [] };

  const codes: NotScorableReasonCode[] = [];
  if (reservation.status !== 'SCHEDULED') codes.push('RESERVATION_NOT_SCHEDULED');

  if (context.snapshotEvidenceSource !== allowedSnapshotEvidence(context.mode)) {
    // Fuente de otro modo (p. ej. réplica real en modo sintético): nunca se mezcla.
    codes.push('NO_USABLE_SNAPSHOT_IN_MODE');
  } else {
    if (reservation.bookingCreatedAt === null) codes.push('MISSING_BOOKING_TIME');
    if (reservation.hasRescheduleEvent && context.mode === 'SYNTHETIC_DEMO_ONLY') {
      codes.push('RESCHEDULED_WITHOUT_ORIGINAL_SNAPSHOT');
    }
    if (
      !reservation.hasRescheduleEvent &&
      reservation.bookingCreatedAt !== null &&
      reservation.bookingCreatedAt.getTime() >= reservation.appointmentAt.getTime()
    )
      codes.push('BOOKING_NOT_BEFORE_APPOINTMENT');
  }

  return codes.length > 0
    ? { availability: 'NOT_SCORABLE', reasons: codes.map(notScorableReason) }
    : { availability: 'NOT_SCORED', reasons: [] };
}
