import type { FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import type { GetReservation } from '../../../application/GetReservation.js';
import {
  toReservationBody,
  toScoreSummaryBody,
} from '../../../../Shared/http/ReservationHttpMapper.js';
import type { GetReservationRequest } from '../request/GetReservationRequest.js';
import type { GetReservationResponse } from '../response/GetReservationResponse.js';

export class GetReservationHandler {
  constructor(private readonly getReservation: GetReservation) {}

  readonly handle = async (
    request: FastifyRequest<GetReservationRequest>,
  ): Promise<GetReservationResponse> => {
    const result = await this.getReservation.execute({
      reservationId: request.params.reservationId,
      clinicScope: requirePrincipal(request).clinicScope,
    });

    return {
      data: {
        ...toReservationBody(result.reservation, result.sourceFreshness),
        hasUsableSnapshot: result.hasUsableSnapshot,
        scores: result.scores.map((score) => toScoreSummaryBody(score)),
        sourceStatus: result.sourceStatus,
      },
      requestId: request.id,
    };
  };
}
