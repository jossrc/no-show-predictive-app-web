import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CheckMlService } from '../../../application/CheckMlService.js';
import type { CheckMlServiceResponse } from '../response/CheckMlServiceResponse.js';

export class CheckMlServiceHandler {
  constructor(private readonly checkMlService: CheckMlService) {}

  readonly handle = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<CheckMlServiceResponse> => {
    const result = await this.checkMlService.execute({ requestId: request.id });

    if (result.status === 'error') {
      reply.status(503);
    }

    return result;
  };
}
