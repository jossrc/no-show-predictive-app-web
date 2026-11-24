import type { FastifyInstance } from 'fastify';
import { strictValidatorCompiler } from '../../../../../../app/http/validation/StrictValidatorCompiler.js';
import type { RecordAttendanceOutcomeHandler } from '../handler/RecordAttendanceOutcomeHandler.js';
import type { RecordAttendanceOutcomeRequest } from '../request/RecordAttendanceOutcomeRequest.js';
import type { RecordAttendanceOutcomeResponse } from '../response/RecordAttendanceOutcomeResponse.js';
import { RecordAttendanceOutcomeSchema } from '../schema/RecordAttendanceOutcomeSchema.js';

/** HU-07: POST /api/v1/reservations/:reservationId/attendance-outcomes. */
export function registerRecordAttendanceOutcomeRoute(
  app: FastifyInstance,
  options: { handler: RecordAttendanceOutcomeHandler },
): void {
  app.post<RecordAttendanceOutcomeRequest & { Reply: RecordAttendanceOutcomeResponse }>(
    '/reservations/:reservationId/attendance-outcomes',
    {
      schema: RecordAttendanceOutcomeSchema,
      bodyLimit: 1024,
      validatorCompiler: strictValidatorCompiler,
    },
    options.handler.handle,
  );
}
