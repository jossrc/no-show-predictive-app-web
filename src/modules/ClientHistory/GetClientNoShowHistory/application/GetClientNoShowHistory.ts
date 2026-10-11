import { canAccessClinic } from '../../../../shared/security/RequestPrincipal.js';
import type { Clock } from '../../../../shared/time/Clock.js';
import { ReservationNotFoundException } from '../../../Reservations/Shared/errors/ReservationNotFoundException.js';
import type { ReservationRepository } from '../../../Reservations/Shared/persistence/ReservationRepository.js';
import { HistoryCutoffUnavailableException } from '../../Shared/errors/HistoryCutoffUnavailableException.js';
import type { ClientHistoryRepository } from '../../Shared/persistence/ClientHistoryRepository.js';
import type { GetClientNoShowHistoryInput } from './input/GetClientNoShowHistoryInput.js';
import type {
  ClientHistoryWarning,
  GetClientNoShowHistoryResult,
} from './result/GetClientNoShowHistoryResult.js';

const BASE_WARNINGS: readonly ClientHistoryWarning[] = [
  'CANCELLATIONS_EXCLUDED',
  'ATTENDANCE_KNOWN_AT_SESSION_CLOSE',
  'NO_SHOW_CANDIDATE_INCLUDES_SYSTEM_TRACKED_RECORDS',
  'SOURCE_AS_OF_LAST_INGESTION',
];

export interface GetClientNoShowHistoryDependencies {
  readonly reservations: Pick<ReservationRepository, 'findById'>;
  readonly history: ClientHistoryRepository;
  readonly clock: Clock;
}

/**
 * HU-06: historial de asistencias/no-show del cliente DE ESA reserva. booking_creation usa el
 * mismo corte que la predicción; current_known es informativo y no altera el score original.
 */
export class GetClientNoShowHistory {
  constructor(private readonly deps: GetClientNoShowHistoryDependencies) {}

  async execute(input: GetClientNoShowHistoryInput): Promise<GetClientNoShowHistoryResult> {
    const reservation = await this.deps.reservations.findById(input.reservationId);
    if (!reservation || !canAccessClinic(input.clinicScope, reservation.clinicId)) {
      throw new ReservationNotFoundException();
    }

    let cutoffAt: Date;
    if (input.historicalAsOf === 'booking_creation') {
      if (!reservation.bookingCreatedAt) throw new HistoryCutoffUnavailableException();
      cutoffAt = reservation.bookingCreatedAt;
    } else {
      cutoffAt = this.deps.clock.now();
    }

    const summary = await this.deps.history.summarizeAsOf(reservation.clientId, cutoffAt);
    const resolvedTotal = summary.previousAttended + summary.previousNoShow;

    return {
      reservationId: reservation.reservationId,
      clientId: reservation.clientId,
      historicalAsOf: input.historicalAsOf,
      cutoffAt,
      historySemantics: 'NO_SHOW_CANDIDATE',
      previousAttended: summary.previousAttended,
      previousNoShow: summary.previousNoShow,
      resolvedTotal,
      noShowRate: resolvedTotal > 0 ? summary.previousNoShow / resolvedTotal : null,
      lastNoShowAt: summary.lastNoShowAt,
      lastAttendedAt: summary.lastAttendedAt,
      warnings:
        input.historicalAsOf === 'current_known'
          ? [...BASE_WARNINGS, 'CURRENT_KNOWN_DOES_NOT_FEED_ORIGINAL_SCORE']
          : BASE_WARNINGS,
    };
  }
}
