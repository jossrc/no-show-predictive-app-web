import type { FastifyInstance } from 'fastify';
import type { GetOverbookingAuthorizationHandler } from '../handler/GetOverbookingAuthorizationHandler.js';
import type { GetOverbookingAuthorizationRequest } from '../request/GetOverbookingAuthorizationRequest.js';
import type { GetOverbookingAuthorizationResponse } from '../response/GetOverbookingAuthorizationResponse.js';
import { GetOverbookingAuthorizationSchema } from '../schema/GetOverbookingAuthorizationSchema.js';

/** HU-06: GET /api/v1/reservations/:reservationId/overbooking-authorization (solo lectura). */
export function registerGetOverbookingAuthorizationRoute(
  app: FastifyInstance,
  options: { handler: GetOverbookingAuthorizationHandler },
): void {
  app.get<GetOverbookingAuthorizationRequest & { Reply: GetOverbookingAuthorizationResponse }>(
    '/reservations/:reservationId/overbooking-authorization',
    { schema: GetOverbookingAuthorizationSchema },
    options.handler.handle,
  );
}
