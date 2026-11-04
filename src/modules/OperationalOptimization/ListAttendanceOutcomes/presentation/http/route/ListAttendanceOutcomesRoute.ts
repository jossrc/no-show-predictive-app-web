import type { FastifyInstance } from 'fastify';
import type { ListAttendanceOutcomesHandler } from '../handler/ListAttendanceOutcomesHandler.js';
import type { ListAttendanceOutcomesRequest } from '../request/ListAttendanceOutcomesRequest.js';
import type { ListAttendanceOutcomesResponse } from '../response/ListAttendanceOutcomesResponse.js';
import { ListAttendanceOutcomesSchema } from '../schema/ListAttendanceOutcomesSchema.js';

/** HU-07: GET /api/v1/attendance-outcomes (solo lectura, paginado). */
export function registerListAttendanceOutcomesRoute(
  app: FastifyInstance,
  options: { handler: ListAttendanceOutcomesHandler },
): void {
  app.get<ListAttendanceOutcomesRequest & { Reply: ListAttendanceOutcomesResponse }>(
    '/attendance-outcomes',
    { schema: ListAttendanceOutcomesSchema },
    options.handler.handle,
  );
}
