import type { HistoricalAsOf } from '../../../Shared/models/HistoricalAsOf.js';

export type ClientHistoryWarning =
  | 'CANCELLATIONS_EXCLUDED'
  | 'ATTENDANCE_KNOWN_AT_SESSION_CLOSE'
  | 'NO_SHOW_CANDIDATE_INCLUDES_SYSTEM_TRACKED_RECORDS'
  | 'SOURCE_AS_OF_LAST_INGESTION'
  | 'CURRENT_KNOWN_DOES_NOT_FEED_ORIGINAL_SCORE';

export interface GetClientNoShowHistoryResult {
  readonly reservationId: string;
  readonly clientId: string;
  readonly historicalAsOf: HistoricalAsOf;
  /** Corte exclusivo: solo eventos con known_at < cutoffAt. */
  readonly cutoffAt: Date;
  readonly historySemantics: 'NO_SHOW_CANDIDATE';
  readonly previousAttended: number;
  readonly previousNoShow: number;
  readonly resolvedTotal: number;
  /** null sin historial resuelto (nunca 0 inventado). */
  readonly noShowRate: number | null;
  readonly lastNoShowAt: Date | null;
  readonly lastAttendedAt: Date | null;
  readonly warnings: readonly ClientHistoryWarning[];
}
