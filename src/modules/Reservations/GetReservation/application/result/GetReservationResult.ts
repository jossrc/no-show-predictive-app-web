import type { DataSourceMode } from '../../../../../shared/data/DataSourceMode.js';
import type { Reservation } from '../../../Shared/models/Reservation.js';
import type { ReservationOperationalStatus } from '../../../Shared/models/ReservationOperationalStatus.js';
import type { ReservationScoreSummary } from '../../../Shared/models/ReservationScoreSummary.js';

export interface GetReservationResult {
  readonly reservation: Reservation;
  readonly sourceFreshness: 'CURRENT' | 'STALE_CLASSIFICATION';
  /** Últimos scores persistidos (exploratorios); el detalle de riesgo vive en /risk. */
  readonly scores: readonly ReservationScoreSummary[];
  readonly hasUsableSnapshot: boolean;
  readonly sourceStatus: DataSourceMode;
  /** Sprint 02: registros de gestión propios; null si el almacén no está disponible. */
  readonly operationalStatus: ReservationOperationalStatus | null;
}
