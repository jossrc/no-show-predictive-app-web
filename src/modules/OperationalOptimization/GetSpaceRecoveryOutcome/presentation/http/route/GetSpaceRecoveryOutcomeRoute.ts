import type { FastifyInstance } from 'fastify';
import type { GetSpaceRecoveryOutcomeHandler } from '../handler/GetSpaceRecoveryOutcomeHandler.js';
import type { GetSpaceRecoveryOutcomeRequest } from '../request/GetSpaceRecoveryOutcomeRequest.js';
import type { GetSpaceRecoveryOutcomeResponse } from '../response/GetSpaceRecoveryOutcomeResponse.js';
import { GetSpaceRecoveryOutcomeSchema } from '../schema/GetSpaceRecoveryOutcomeSchema.js';

/** HU-08: GET /api/v1/reservations/:reservationId/space-recovery-outcome (solo lectura). */
export function registerGetSpaceRecoveryOutcomeRoute(
  app: FastifyInstance,
  options: { handler: GetSpaceRecoveryOutcomeHandler },
): void {
  app.get<GetSpaceRecoveryOutcomeRequest & { Reply: GetSpaceRecoveryOutcomeResponse }>(
    '/reservations/:reservationId/space-recovery-outcome',
    { schema: GetSpaceRecoveryOutcomeSchema },
    options.handler.handle,
  );
}
