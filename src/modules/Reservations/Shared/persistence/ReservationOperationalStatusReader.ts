import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { ReservationOperationalStatus } from '../models/ReservationOperationalStatus.js';

/**
 * Lectura por lote (sin N+1) de los registros de gestión propios (HU-06/07/08) del almacén
 * PostgreSQL de la app. Una reserva sin registros puede faltar en el mapa. Nunca escribe.
 */
export interface ReservationOperationalStatusReader {
  statusesFor(
    reservationIds: readonly DecimalId[],
  ): Promise<ReadonlyMap<DecimalId, ReservationOperationalStatus>>;
}
