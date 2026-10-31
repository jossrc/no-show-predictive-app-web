import type { FastifyPluginAsync } from 'fastify';
import type { DataSourceMode } from '../../shared/data/DataSourceMode.js';
import type { Clock } from '../../shared/time/Clock.js';
import { GetReservation } from './GetReservation/application/GetReservation.js';
import { GetReservationHandler } from './GetReservation/presentation/http/handler/GetReservationHandler.js';
import { registerGetReservationRoute } from './GetReservation/presentation/http/route/GetReservationRoute.js';
import type { ReservationRepository } from './Shared/persistence/ReservationRepository.js';

export interface ReservationsModuleOptions {
  reservations: ReservationRepository;
  clock: Clock;
  mode: DataSourceMode;
}

export function createReservationsModule(options: ReservationsModuleOptions): FastifyPluginAsync {
  return async (app): Promise<void> => {
    const getReservation = new GetReservation(options.reservations, options.clock, options.mode);
    registerGetReservationRoute(app, { handler: new GetReservationHandler(getReservation) });
  };
}
