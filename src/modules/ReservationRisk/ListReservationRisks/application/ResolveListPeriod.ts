import { InvalidReservationQueryException } from '../../../Reservations/Shared/errors/InvalidReservationQueryException.js';
import {
  daysBetween,
  limaDayRangeToInstants,
  parseLocalDate,
} from '../../../../shared/time/LimaTime.js';

/** Máximo de días consultables por petición: evita escaneos de años completos. */
export const MAX_LIST_PERIOD_DAYS = 92;

export function resolveListPeriod(
  from: string,
  to: string,
): { startInclusive: Date; endExclusive: Date } {
  const fromDate = parseLocalDate(from);
  const toDate = parseLocalDate(to);

  if (!fromDate || !toDate) {
    throw new InvalidReservationQueryException('INVALID_PERIOD', 'from', 'Fechas inválidas');
  }

  const span = daysBetween(fromDate, toDate);
  if (span < 0) {
    throw new InvalidReservationQueryException(
      'INVALID_PERIOD',
      'to',
      'La fecha final debe ser igual o posterior a la inicial',
    );
  }
  if (span > MAX_LIST_PERIOD_DAYS) {
    throw new InvalidReservationQueryException(
      'INVALID_PERIOD',
      'to',
      `El período no puede superar ${MAX_LIST_PERIOD_DAYS} días`,
    );
  }

  return limaDayRangeToInstants(fromDate, toDate);
}
