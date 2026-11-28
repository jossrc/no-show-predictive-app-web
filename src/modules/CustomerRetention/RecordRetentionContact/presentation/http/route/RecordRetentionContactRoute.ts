import type { FastifyInstance } from 'fastify';
import { strictValidatorCompiler } from '../../../../../../app/http/validation/StrictValidatorCompiler.js';
import type { RecordRetentionContactHandler } from '../handler/RecordRetentionContactHandler.js';
import type { RecordRetentionContactRequest } from '../request/RecordRetentionContactRequest.js';
import type { RecordRetentionContactResponse } from '../response/RecordRetentionContactResponse.js';
import { RecordRetentionContactSchema } from '../schema/RecordRetentionContactSchema.js';

/** POST /api/v1/reservations/:reservationId/retention-contacts (cuerpo JSON estricto). */
export function registerRecordRetentionContactRoute(
  app: FastifyInstance,
  options: { handler: RecordRetentionContactHandler },
): void {
  app.post<RecordRetentionContactRequest & { Reply: RecordRetentionContactResponse }>(
    '/reservations/:reservationId/retention-contacts',
    {
      schema: RecordRetentionContactSchema,
      bodyLimit: 1024,
      validatorCompiler: strictValidatorCompiler,
    },
    options.handler.handle,
  );
}
