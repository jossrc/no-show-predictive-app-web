import type { FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import { OVERBOOKING_STATUS_LABELS } from '../../../../../Reservations/Shared/http/OperationalStatusHttp.js';
import {
  toAuthorizationBody,
  toEligibilityBody,
} from '../../../../Shared/http/OperationalHttpMapper.js';
import type { GetOverbookingAuthorization } from '../../../application/GetOverbookingAuthorization.js';
import type { GetOverbookingAuthorizationRequest } from '../request/GetOverbookingAuthorizationRequest.js';
import type { GetOverbookingAuthorizationResponse } from '../response/GetOverbookingAuthorizationResponse.js';

export class GetOverbookingAuthorizationHandler {
  constructor(private readonly getOverbookingAuthorization: GetOverbookingAuthorization) {}

  readonly handle = async (
    request: FastifyRequest<GetOverbookingAuthorizationRequest>,
  ): Promise<GetOverbookingAuthorizationResponse> => {
    const result = await this.getOverbookingAuthorization.execute({
      reservationId: request.params.reservationId,
      clinicScope: requirePrincipal(request).clinicScope,
    });
    const status = result.authorization ? 'ENABLED' : 'NOT_ENABLED';
    return {
      data: {
        reservationId: result.reservationId,
        enabled: result.authorization !== null,
        status,
        statusLabel: OVERBOOKING_STATUS_LABELS[status],
        authorization: result.authorization ? toAuthorizationBody(result.authorization) : null,
        eligibility: toEligibilityBody(result.eligibility),
      },
      requestId: request.id,
    };
  };
}
