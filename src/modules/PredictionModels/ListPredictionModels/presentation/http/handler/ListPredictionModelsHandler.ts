import type { FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import type { ListPredictionModels } from '../../../application/ListPredictionModels.js';
import type { ListPredictionModelsResponse } from '../response/ListPredictionModelsResponse.js';

export class ListPredictionModelsHandler {
  constructor(private readonly listPredictionModels: ListPredictionModels) {}

  readonly handle = async (request: FastifyRequest): Promise<ListPredictionModelsResponse> => {
    requirePrincipal(request);
    const data = await this.listPredictionModels.execute({ requestId: request.id });
    return { data, requestId: request.id };
  };
}
