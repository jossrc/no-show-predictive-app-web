import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';

/**
 * Historial de asistencia/no-show conocido estrictamente ANTES del corte (`known_at < cutoffAt`).
 * Fuente: analytics.ml_history_cumulative_v1 (ETL 13). Cancelaciones NO cuentan como no-show.
 */
export interface ClientHistoryAsOfSummary {
  readonly clientId: DecimalId;
  /** Corte exclusivo. */
  readonly cutoffAt: Date;
  readonly previousAttended: number;
  readonly previousNoShow: number;
  readonly lastAttendedAt: Date | null;
  readonly lastNoShowAt: Date | null;
  /** known_at del último evento incluido (auditoría as-of); null si no hay eventos. */
  readonly latestKnownAt: Date | null;
}

export function emptyClientHistory(clientId: DecimalId, cutoffAt: Date): ClientHistoryAsOfSummary {
  return {
    clientId,
    cutoffAt,
    previousAttended: 0,
    previousNoShow: 0,
    lastAttendedAt: null,
    lastNoShowAt: null,
    latestKnownAt: null,
  };
}
