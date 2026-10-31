import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CheckPredictiveStore } from '../../../application/CheckPredictiveStore.js';
import type { CheckPredictiveStoreResponse } from '../response/CheckPredictiveStoreResponse.js';

export class CheckPredictiveStoreHandler {
  constructor(private readonly checkPredictiveStore: CheckPredictiveStore) {}

  readonly handle = async (
    _request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<CheckPredictiveStoreResponse> => {
    const result = this.checkPredictiveStore.execute();
    if (result.status === 'error') reply.status(503);
    return result;
  };
}
