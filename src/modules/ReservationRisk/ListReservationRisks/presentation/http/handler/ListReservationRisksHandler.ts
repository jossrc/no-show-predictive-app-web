import type { FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import {
  toReservationBody,
  toScoreSummaryBody,
} from '../../../../../Reservations/Shared/http/ReservationHttpMapper.js';
import type { ListReservationRisks } from '../../../application/ListReservationRisks.js';
import type { ListReservationRisksRequest } from '../request/ListReservationRisksQuery.js';
import type { ListReservationRisksResponse } from '../response/ListReservationRisksResponse.js';

export class ListReservationRisksHandler {
  constructor(private readonly listReservationRisks: ListReservationRisks) {}

  readonly handle = async (
    request: FastifyRequest<ListReservationRisksRequest>,
  ): Promise<ListReservationRisksResponse> => {
    const query = request.query;
    const result = await this.listReservationRisks.execute({
      from: query.from,
      to: query.to,
      status: query.status,
      clinicId: query.clinicId === undefined ? null : Number(query.clinicId),
      sort: query.sort,
      direction: query.direction,
      modelKey: query.modelKey,
      riskLevel: query.riskLevel ?? null,
      limit: query.limit,
      cursor: query.cursor ?? null,
      clinicScope: requirePrincipal(request).clinicScope,
    });

    return {
      data: result.items.map((item) => ({
        ...toReservationBody(item.reservation, item.sourceFreshness),
        risk: {
          predictionAvailability: item.predictionAvailability,
          notScorableReasons: [...item.notScorableReasons],
          riskLevel: null,
          riskPolicyStatus: result.riskPolicyStatus,
          classificationUnavailable: result.classificationUnavailable,
          validationStatus: 'EXPLORATORY_NOT_VALIDATED',
          probabilities: item.scores.map((score) =>
            toScoreSummaryBody(score, score.policyRiskLevel),
          ),
        },
      })),
      pagination: { limit: result.limit, nextCursor: result.nextCursor },
      period: {
        from: result.period.from,
        to: result.period.to,
        timeZone: result.period.timeZone,
        startInclusive: result.period.startInclusive.toISOString(),
        endExclusive: result.period.endExclusive.toISOString(),
      },
      sort: result.sort,
      riskPolicyStatus: result.riskPolicyStatus,
      classificationUnavailable: result.classificationUnavailable,
      sourceStatus: result.sourceStatus,
      predictiveStoreAvailable: result.predictiveStoreAvailable,
      requestId: request.id,
    };
  };
}
