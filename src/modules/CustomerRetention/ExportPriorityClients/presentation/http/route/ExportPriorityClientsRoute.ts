import type { FastifyInstance } from 'fastify';
import type { ExportPriorityClientsHandler } from '../handler/ExportPriorityClientsHandler.js';
import type { ExportPriorityClientsRequest } from '../request/ExportPriorityClientsRequest.js';
import { ExportPriorityClientsSchema } from '../schema/ExportPriorityClientsSchema.js';

/** GET /api/v1/retention/priority-clients/export (descarga CSV; solo lectura). */
export function registerExportPriorityClientsRoute(
  app: FastifyInstance,
  options: { handler: ExportPriorityClientsHandler },
): void {
  app.get<ExportPriorityClientsRequest>(
    '/retention/priority-clients/export',
    { schema: ExportPriorityClientsSchema },
    options.handler.handle,
  );
}
