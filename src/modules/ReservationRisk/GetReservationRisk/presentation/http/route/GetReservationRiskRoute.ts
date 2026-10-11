import type { FastifyInstance } from 'fastify';
import type { GetReservationRiskHandler } from '../handler/GetReservationRiskHandler.js';
import type { GetReservationRiskRequest } from '../request/GetReservationRiskRequest.js';
import type { GetReservationRiskResponse } from '../response/GetReservationRiskResponse.js';
import { GetReservationRiskSchema } from '../schema/GetReservationRiskSchema.js';

/** HU-02 lectura: sin efectos secundarios ni llamadas a Python. */
export function registerGetReservationRiskRoute(
  app: FastifyInstance,
  options: { handler: GetReservationRiskHandler },
): void {
  app.get<GetReservationRiskRequest & { Reply: GetReservationRiskResponse }>(
    '/reservations/:reservationId/risk',
    { schema: GetReservationRiskSchema },
    options.handler.handle,
  );
}
