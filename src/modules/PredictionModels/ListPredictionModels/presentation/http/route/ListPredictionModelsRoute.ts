import type { FastifyInstance } from 'fastify';
import type { ListPredictionModelsHandler } from '../handler/ListPredictionModelsHandler.js';
import type { ListPredictionModelsResponse } from '../response/ListPredictionModelsResponse.js';
import { ListPredictionModelsSchema } from '../schema/ListPredictionModelsSchema.js';

export function registerListPredictionModelsRoute(
  app: FastifyInstance,
  options: { handler: ListPredictionModelsHandler },
): void {
  app.get<{ Reply: ListPredictionModelsResponse }>(
    '/ml/models',
    { schema: ListPredictionModelsSchema },
    options.handler.handle,
  );
}
