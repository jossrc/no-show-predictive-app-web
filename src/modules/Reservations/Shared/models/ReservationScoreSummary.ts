import type { MlModelKey } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { Reservation } from './Reservation.js';

/** Último score persistido por modelo para la reserva (lectura; nunca dispara inferencia). */
export interface ReservationScoreSummary {
  readonly modelKey: MlModelKey;
  readonly modelVersion: string;
  readonly modelHash: string;
  readonly probabilityNoShow: number;
  readonly scoredAt: Date;
  readonly predictionRunId: string;
}

export interface ReservationWithScores {
  readonly reservation: Reservation;
  readonly scores: readonly ReservationScoreSummary[];
  /** Existe snapshot booking_creation utilizable en el modo de datos activo. */
  readonly hasUsableSnapshot: boolean;
}
