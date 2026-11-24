import type { FastifyReply, FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import { toAuthorizationBody } from '../../../../Shared/http/OperationalHttpMapper.js';
import type { EnableOverbooking } from '../../../application/EnableOverbooking.js';
import type { EnableOverbookingRequest } from '../request/EnableOverbookingRequest.js';
import type { EnableOverbookingResponse } from '../response/EnableOverbookingResponse.js';

export class EnableOverbookingHandler {
  constructor(private readonly enableOverbooking: EnableOverbooking) {}

  readonly handle = async (
    request: FastifyRequest<EnableOverbookingRequest>,
    reply: FastifyReply,
  ): Promise<EnableOverbookingResponse> => {
    const result = await this.enableOverbooking.execute({
      reservationId: request.params.reservationId,
      clinicScope: requirePrincipal(request).clinicScope,
      modelKey: request.body.modelKey,
      predictionRunId: request.body.predictionRunId.toLowerCase(),
      requestId: request.id,
    });

    // 201 si esta petición creó la marca; 200 en reintento idéntico (sin INSERT nuevo).
    reply.status(result.replayed ? 200 : 201);
    return {
      data: {
        ...toAuthorizationBody(result.authorization),
        enabled: true,
        replayed: result.replayed,
      },
      requestId: request.id,
    };
  };
}
