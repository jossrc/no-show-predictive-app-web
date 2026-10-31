export interface GetClientNoShowHistoryResponse {
  data: {
    reservationId: string;
    clientId: string;
    historicalAsOf: 'booking_creation' | 'current_known';
    cutoffAt: string;
    cutoffSemantics: 'known_at < cutoffAt';
    historySemantics: 'NO_SHOW_CANDIDATE';
    previousAttended: number;
    previousNoShow: number;
    resolvedTotal: number;
    noShowRate: number | null;
    lastNoShowAt: string | null;
    lastAttendedAt: string | null;
    warnings: string[];
  };
  requestId: string;
}
