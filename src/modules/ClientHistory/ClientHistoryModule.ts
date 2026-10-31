import type { FastifyPluginAsync } from 'fastify';
import type { Clock } from '../../shared/time/Clock.js';
import type { ReservationRepository } from '../Reservations/Shared/persistence/ReservationRepository.js';
import { GetClientNoShowHistory } from './GetClientNoShowHistory/application/GetClientNoShowHistory.js';
import { GetClientNoShowHistoryHandler } from './GetClientNoShowHistory/presentation/http/handler/GetClientNoShowHistoryHandler.js';
import { registerGetClientNoShowHistoryRoute } from './GetClientNoShowHistory/presentation/http/route/GetClientNoShowHistoryRoute.js';
import type { ClientHistoryRepository } from './Shared/persistence/ClientHistoryRepository.js';

export interface ClientHistoryModuleOptions {
  reservations: ReservationRepository;
  history: ClientHistoryRepository;
  clock: Clock;
}

export function createClientHistoryModule(options: ClientHistoryModuleOptions): FastifyPluginAsync {
  return async (app): Promise<void> => {
    const getClientNoShowHistory = new GetClientNoShowHistory({
      reservations: options.reservations,
      history: options.history,
      clock: options.clock,
    });
    registerGetClientNoShowHistoryRoute(app, {
      handler: new GetClientNoShowHistoryHandler(getClientNoShowHistory),
    });
  };
}
