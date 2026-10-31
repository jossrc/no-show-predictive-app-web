import type { FastifyInstance } from 'fastify';
import type { GetClientNoShowHistoryHandler } from '../handler/GetClientNoShowHistoryHandler.js';
import type { GetClientNoShowHistoryRequest } from '../request/GetClientNoShowHistoryRequest.js';
import type { GetClientNoShowHistoryResponse } from '../response/GetClientNoShowHistoryResponse.js';
import { GetClientNoShowHistorySchema } from '../schema/GetClientNoShowHistorySchema.js';

/** HU-06: el cliente se deriva de la reserva; no se acepta clientId del consumidor. */
export function registerGetClientNoShowHistoryRoute(
  app: FastifyInstance,
  options: { handler: GetClientNoShowHistoryHandler },
): void {
  app.get<GetClientNoShowHistoryRequest & { Reply: GetClientNoShowHistoryResponse }>(
    '/reservations/:reservationId/client-history',
    { schema: GetClientNoShowHistorySchema },
    options.handler.handle,
  );
}
