import type { FastifyReply, FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import { toSpaceRecoveryOutcomeBody } from '../../../../Shared/http/OperationalHttpMapper.js';
import type { RecordSpaceRecoveryOutcome } from '../../../application/RecordSpaceRecoveryOutcome.js';
import type { RecordSpaceRecoveryOutcomeRequest } from '../request/RecordSpaceRecoveryOutcomeRequest.js';
import type { RecordSpaceRecoveryOutcomeResponse } from '../response/RecordSpaceRecoveryOutcomeResponse.js';

export class RecordSpaceRecoveryOutcomeHandler {
  constructor(private readonly recordSpaceRecoveryOutcome: RecordSpaceRecoveryOutcome) {}

  readonly handle = async (
    request: FastifyRequest<RecordSpaceRecoveryOutcomeRequest>,
    reply: FastifyReply,
  ): Promise<RecordSpaceRecoveryOutcomeResponse> => {
    const result = await this.recordSpaceRecoveryOutcome.execute({
      reservationId: request.params.reservationId,
      clinicScope: requirePrincipal(request).clinicScope,
      spaceRecovered: request.body.spaceRecovered,
      requestId: request.id,
    });

    reply.status(result.replayed ? 200 : 201);
    return {
      data: { ...toSpaceRecoveryOutcomeBody(result.outcome), replayed: result.replayed },
      requestId: request.id,
    };
  };
}
