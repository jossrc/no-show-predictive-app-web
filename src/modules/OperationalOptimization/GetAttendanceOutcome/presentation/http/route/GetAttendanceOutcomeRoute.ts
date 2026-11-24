import type { FastifyInstance } from 'fastify';
import type { GetAttendanceOutcomeHandler } from '../handler/GetAttendanceOutcomeHandler.js';
import type { GetAttendanceOutcomeRequest } from '../request/GetAttendanceOutcomeRequest.js';
import type { GetAttendanceOutcomeResponse } from '../response/GetAttendanceOutcomeResponse.js';
import { GetAttendanceOutcomeSchema } from '../schema/GetAttendanceOutcomeSchema.js';

/** HU-07: GET /api/v1/reservations/:reservationId/attendance-outcome (solo lectura). */
export function registerGetAttendanceOutcomeRoute(
  app: FastifyInstance,
  options: { handler: GetAttendanceOutcomeHandler },
): void {
  app.get<GetAttendanceOutcomeRequest & { Reply: GetAttendanceOutcomeResponse }>(
    '/reservations/:reservationId/attendance-outcome',
    { schema: GetAttendanceOutcomeSchema },
    options.handler.handle,
  );
}
