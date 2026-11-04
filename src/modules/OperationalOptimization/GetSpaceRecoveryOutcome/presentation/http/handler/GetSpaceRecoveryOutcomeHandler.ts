import type { FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import { toSpaceRecoveryOutcomeBody } from '../../../../Shared/http/OperationalHttpMapper.js';
import type { GetSpaceRecoveryOutcome } from '../../../application/GetSpaceRecoveryOutcome.js';
import type { GetSpaceRecoveryOutcomeRequest } from '../request/GetSpaceRecoveryOutcomeRequest.js';
import type { GetSpaceRecoveryOutcomeResponse } from '../response/GetSpaceRecoveryOutcomeResponse.js';

export class GetSpaceRecoveryOutcomeHandler {
  constructor(private readonly getSpaceRecoveryOutcome: GetSpaceRecoveryOutcome) {}

  readonly handle = async (
    request: FastifyRequest<GetSpaceRecoveryOutcomeRequest>,
  ): Promise<GetSpaceRecoveryOutcomeResponse> => {
    const result = await this.getSpaceRecoveryOutcome.execute({
      reservationId: request.params.reservationId,
      clinicScope: requirePrincipal(request).clinicScope,
    });
    const blocker = !result.authorization
      ? 'PREVENTIVE_ACTION_REQUIRED'
      : result.outcome
        ? 'ALREADY_RECORDED'
        : null;
    return {
      data: {
        reservationId: result.reservationId,
        recorded: result.outcome !== null,
        spaceRecovered: result.outcome?.spaceRecovered ?? null,
        outcome: result.outcome ? toSpaceRecoveryOutcomeBody(result.outcome) : null,
        preventiveAction: {
          enabled: result.authorization !== null,
          authorizationId: result.authorization?.authorizationId ?? null,
        },
        registrable: blocker === null,
        blocker,
      },
      requestId: request.id,
    };
  };
}
