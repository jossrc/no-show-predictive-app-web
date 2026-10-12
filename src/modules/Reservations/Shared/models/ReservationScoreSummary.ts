import type { MlModelKey } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { Reservation } from './Reservation.js';

export const EXPERIMENTAL_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ExperimentalRiskLevel = (typeof EXPERIMENTAL_RISK_LEVELS)[number];

/** Banda relativa experimental (política research v2) tal como se persistió con el score. */
export interface ExperimentalRiskSummary {
  readonly level: ExperimentalRiskLevel;
  readonly label: 'Bajo (exploratorio)' | 'Medio (exploratorio)' | 'Alto (exploratorio)';
  readonly status: 'RESEARCH_PROVISIONAL';
  readonly policyId: string;
  readonly policyVersion: string;
  readonly policyHash: string;
}

/** Último score persistido por modelo para la reserva (lectura; nunca dispara inferencia). */
export interface ReservationScoreSummary {
  readonly modelKey: MlModelKey;
  readonly modelVersion: string;
  readonly modelHash: string;
  readonly probabilityNoShow: number;
  readonly scoredAt: Date;
  readonly predictionRunId: string;
  /** null si el score se obtuvo sin política research (v1) o con la política deshabilitada. */
  readonly experimentalRisk: ExperimentalRiskSummary | null;
}

export interface ReservationWithScores {
  readonly reservation: Reservation;
  readonly scores: readonly ReservationScoreSummary[];
  /** Existe snapshot booking_creation utilizable en el modo de datos activo. */
  readonly hasUsableSnapshot: boolean;
}
