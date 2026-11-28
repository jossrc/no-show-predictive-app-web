import type { FastifyInstance } from 'fastify';
import type { ListPriorityClientsHandler } from '../handler/ListPriorityClientsHandler.js';
import type { ListPriorityClientsRequest } from '../request/ListPriorityClientsRequest.js';
import type { ListPriorityClientsResponse } from '../response/ListPriorityClientsResponse.js';
import { ListPriorityClientsSchema } from '../schema/ListPriorityClientsSchema.js';

/** GET /api/v1/retention/priority-clients (solo lectura: no predice ni escribe). */
export function registerListPriorityClientsRoute(
  app: FastifyInstance,
  options: { handler: ListPriorityClientsHandler },
): void {
  app.get<ListPriorityClientsRequest & { Reply: ListPriorityClientsResponse }>(
    '/retention/priority-clients',
    { schema: ListPriorityClientsSchema },
    options.handler.handle,
  );
}
