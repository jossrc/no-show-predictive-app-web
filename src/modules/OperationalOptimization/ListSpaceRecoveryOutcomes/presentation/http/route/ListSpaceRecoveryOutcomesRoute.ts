import type { FastifyInstance } from 'fastify';
import type { ListSpaceRecoveryOutcomesHandler } from '../handler/ListSpaceRecoveryOutcomesHandler.js';
import type { ListSpaceRecoveryOutcomesRequest } from '../request/ListSpaceRecoveryOutcomesRequest.js';
import type { ListSpaceRecoveryOutcomesResponse } from '../response/ListSpaceRecoveryOutcomesResponse.js';
import { ListSpaceRecoveryOutcomesSchema } from '../schema/ListSpaceRecoveryOutcomesSchema.js';

/** HU-08: GET /api/v1/space-recovery-outcomes (solo lectura, paginado). */
export function registerListSpaceRecoveryOutcomesRoute(
  app: FastifyInstance,
  options: { handler: ListSpaceRecoveryOutcomesHandler },
): void {
  app.get<ListSpaceRecoveryOutcomesRequest & { Reply: ListSpaceRecoveryOutcomesResponse }>(
    '/space-recovery-outcomes',
    { schema: ListSpaceRecoveryOutcomesSchema },
    options.handler.handle,
  );
}
