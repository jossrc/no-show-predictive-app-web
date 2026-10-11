import { isMlModelKey } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { ReservationScoreSummary } from '../../models/ReservationScoreSummary.js';
import { deriveReservationStatus } from '../../models/ReservationStatus.js';
import type { ReservationListRow } from '../ReservationRepository.js';

export interface ReservationRow {
  reservation_id: string;
  client_id: string;
  clinic_id: number;
  appointment_at: Date;
  created_at_source: Date | null;
  outcome: string;
  classification_detail: string | null;
  classification_cutoff_at: Date | null;
  sort_probability: number | null;
  has_reschedule_event: boolean;
  has_usable_snapshot: boolean;
  scores: unknown;
}

interface RawScore {
  modelKey?: unknown;
  modelVersion?: unknown;
  modelHash?: unknown;
  probabilityNoShow?: unknown;
  scoredAt?: unknown;
  predictionRunId?: unknown;
}

function mapScores(raw: unknown): ReservationScoreSummary[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item: RawScore) => {
    if (
      !isMlModelKey(item.modelKey) ||
      typeof item.modelVersion !== 'string' ||
      typeof item.modelHash !== 'string' ||
      typeof item.probabilityNoShow !== 'number' ||
      typeof item.scoredAt !== 'string' ||
      typeof item.predictionRunId !== 'string'
    ) {
      return [];
    }

    return [
      {
        modelKey: item.modelKey,
        modelVersion: item.modelVersion,
        modelHash: item.modelHash,
        probabilityNoShow: item.probabilityNoShow,
        scoredAt: new Date(item.scoredAt),
        predictionRunId: item.predictionRunId,
      },
    ];
  });
}

/** Devuelve null si la fila no es una reserva (borrador, copia de reprogramación, bloqueo…). */
export function mapReservationRow(row: ReservationRow): ReservationListRow | null {
  const status = deriveReservationStatus(row.outcome, row.classification_detail);
  if (status === null) return null;

  return {
    reservation: {
      reservationId: row.reservation_id,
      clientId: row.client_id,
      clinicId: Number(row.clinic_id),
      appointmentAt: row.appointment_at,
      bookingCreatedAt: row.created_at_source,
      status,
      sourceClassification: status === 'PAST' ? null : row.classification_detail,
      hasRescheduleEvent: row.has_reschedule_event === true,
      classificationCutoffAt: row.classification_cutoff_at,
    },
    scores: mapScores(row.scores),
    hasUsableSnapshot: row.has_usable_snapshot === true,
    sortProbability: row.sort_probability === null ? null : Number(row.sort_probability),
  };
}
