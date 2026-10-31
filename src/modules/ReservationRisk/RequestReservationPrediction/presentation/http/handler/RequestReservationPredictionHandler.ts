import type { FastifyReply, FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import { toRiskAssessmentBody } from '../../../../Shared/http/RiskAssessmentHttpMapper.js';
import type { RequestReservationPrediction } from '../../../application/RequestReservationPrediction.js';
import type { RequestReservationPredictionRequest } from '../request/RequestReservationPredictionRequest.js';
import type { RequestReservationPredictionResponse } from '../response/RequestReservationPredictionResponse.js';

export class RequestReservationPredictionHandler {
  constructor(private readonly requestReservationPrediction: RequestReservationPrediction) {}

  readonly handle = async (
    request: FastifyRequest<RequestReservationPredictionRequest>,
    reply: FastifyReply,
  ): Promise<RequestReservationPredictionResponse> => {
    const body = request.body;
    const result = await this.requestReservationPrediction.execute({
      reservationId: request.params.reservationId,
      prediction:
        body.mode === 'single' ? { mode: 'single', modelKey: body.modelKey } : { mode: 'compare' },
      requestId: request.id,
      clinicScope: requirePrincipal(request).clinicScope,
    });

    // 201 si esta petición creó un run; 200 si se reutilizaron resultados (idempotencia).
    reply.status(result.run.predictionRunId === null ? 200 : 201);

    return {
      data: {
        ...toRiskAssessmentBody(result.assessment),
        run: { ...result.run, requestedModelKeys: [...result.run.requestedModelKeys] },
        featureWarnings: [...result.featureWarnings],
      },
      requestId: request.id,
    };
  };
}
