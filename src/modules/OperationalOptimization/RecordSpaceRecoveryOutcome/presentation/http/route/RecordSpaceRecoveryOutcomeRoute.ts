import type { FastifyInstance } from 'fastify';
import { strictValidatorCompiler } from '../../../../../../app/http/validation/StrictValidatorCompiler.js';
import type { RecordSpaceRecoveryOutcomeHandler } from '../handler/RecordSpaceRecoveryOutcomeHandler.js';
import type { RecordSpaceRecoveryOutcomeRequest } from '../request/RecordSpaceRecoveryOutcomeRequest.js';
import type { RecordSpaceRecoveryOutcomeResponse } from '../response/RecordSpaceRecoveryOutcomeResponse.js';
import { RecordSpaceRecoveryOutcomeSchema } from '../schema/RecordSpaceRecoveryOutcomeSchema.js';

/** HU-08: POST /api/v1/reservations/:reservationId/space-recovery-outcomes. */
export function registerRecordSpaceRecoveryOutcomeRoute(
  app: FastifyInstance,
  options: { handler: RecordSpaceRecoveryOutcomeHandler },
): void {
  app.post<RecordSpaceRecoveryOutcomeRequest & { Reply: RecordSpaceRecoveryOutcomeResponse }>(
    '/reservations/:reservationId/space-recovery-outcomes',
    {
      schema: RecordSpaceRecoveryOutcomeSchema,
      bodyLimit: 1024,
      validatorCompiler: strictValidatorCompiler,
    },
    options.handler.handle,
  );
}
