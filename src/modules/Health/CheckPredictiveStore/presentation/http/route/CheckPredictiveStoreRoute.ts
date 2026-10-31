import type { FastifyInstance } from 'fastify';
import type { CheckPredictiveStoreHandler } from '../handler/CheckPredictiveStoreHandler.js';
import type { CheckPredictiveStoreResponse } from '../response/CheckPredictiveStoreResponse.js';
import { CheckPredictiveStoreSchema } from '../schema/CheckPredictiveStoreSchema.js';

export function registerCheckPredictiveStoreRoute(
  app: FastifyInstance,
  options: { handler: CheckPredictiveStoreHandler },
): void {
  app.get<{ Reply: CheckPredictiveStoreResponse }>(
    '/v1/health/predictive-store',
    { schema: CheckPredictiveStoreSchema },
    options.handler.handle,
  );
}
