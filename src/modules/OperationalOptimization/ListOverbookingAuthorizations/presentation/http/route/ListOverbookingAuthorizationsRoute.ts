import type { FastifyInstance } from 'fastify';
import type { ListOverbookingAuthorizationsHandler } from '../handler/ListOverbookingAuthorizationsHandler.js';
import type { ListOverbookingAuthorizationsRequest } from '../request/ListOverbookingAuthorizationsRequest.js';
import type { ListOverbookingAuthorizationsResponse } from '../response/ListOverbookingAuthorizationsResponse.js';
import { ListOverbookingAuthorizationsSchema } from '../schema/ListOverbookingAuthorizationsSchema.js';

/** HU-06: GET /api/v1/overbooking-authorizations (solo lectura, paginado). */
export function registerListOverbookingAuthorizationsRoute(
  app: FastifyInstance,
  options: { handler: ListOverbookingAuthorizationsHandler },
): void {
  app.get<ListOverbookingAuthorizationsRequest & { Reply: ListOverbookingAuthorizationsResponse }>(
    '/overbooking-authorizations',
    { schema: ListOverbookingAuthorizationsSchema },
    options.handler.handle,
  );
}
