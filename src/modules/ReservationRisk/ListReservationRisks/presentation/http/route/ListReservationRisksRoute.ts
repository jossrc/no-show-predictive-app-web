import type { FastifyInstance } from 'fastify';
import type { ListReservationRisksHandler } from '../handler/ListReservationRisksHandler.js';
import type { ListReservationRisksRequest } from '../request/ListReservationRisksQuery.js';
import type { ListReservationRisksResponse } from '../response/ListReservationRisksResponse.js';
import { ListReservationRisksSchema } from '../schema/ListReservationRisksSchema.js';

/** HU-01/HU-03: GET /api/v1/reservations (citas programadas + scores persistidos). */
export function registerListReservationRisksRoute(
  app: FastifyInstance,
  options: { handler: ListReservationRisksHandler },
): void {
  app.get<ListReservationRisksRequest & { Reply: ListReservationRisksResponse }>(
    '/reservations',
    { schema: ListReservationRisksSchema },
    options.handler.handle,
  );
}
