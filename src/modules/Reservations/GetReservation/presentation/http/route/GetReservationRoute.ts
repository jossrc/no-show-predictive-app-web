import type { FastifyInstance } from 'fastify';
import type { GetReservationHandler } from '../handler/GetReservationHandler.js';
import type { GetReservationRequest } from '../request/GetReservationRequest.js';
import type { GetReservationResponse } from '../response/GetReservationResponse.js';
import { GetReservationSchema } from '../schema/GetReservationSchema.js';

export function registerGetReservationRoute(
  app: FastifyInstance,
  options: { handler: GetReservationHandler },
): void {
  app.get<GetReservationRequest & { Reply: GetReservationResponse }>(
    '/reservations/:reservationId',
    { schema: GetReservationSchema },
    options.handler.handle,
  );
}
