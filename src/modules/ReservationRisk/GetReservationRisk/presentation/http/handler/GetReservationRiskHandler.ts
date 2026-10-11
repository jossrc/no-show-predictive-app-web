import type { FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import { toRiskAssessmentBody } from '../../../../Shared/http/RiskAssessmentHttpMapper.js';
import type { GetReservationRisk } from '../../../application/GetReservationRisk.js';
import type { GetReservationRiskRequest } from '../request/GetReservationRiskRequest.js';
import type { GetReservationRiskResponse } from '../response/GetReservationRiskResponse.js';

export class GetReservationRiskHandler {
  constructor(private readonly getReservationRisk: GetReservationRisk) {}

  readonly handle = async (
    request: FastifyRequest<GetReservationRiskRequest>,
  ): Promise<GetReservationRiskResponse> => {
    const result = await this.getReservationRisk.execute({
      reservationId: request.params.reservationId,
      clinicScope: requirePrincipal(request).clinicScope,
    });

    return {
      data: { ...toRiskAssessmentBody(result.assessment), sourceFreshness: result.sourceFreshness },
      requestId: request.id,
    };
  };
}
