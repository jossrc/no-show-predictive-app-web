import type { FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import {
  toReservationBody,
  toScoreSummaryBody,
} from '../../../../../Reservations/Shared/http/ReservationHttpMapper.js';
import { EXPERIMENTAL_RISK_NOTICE } from '../../../../Shared/http/RiskAssessmentHttpMapper.js';
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
      experimentalRiskLevel: query.experimentalRiskLevel ?? null,
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
          classificationUnavailable:
            result.operationalClassificationUnavailable && item.experimentalRisk === null,
          operationalClassificationUnavailable: result.operationalClassificationUnavailable,
          experimentalClassificationUnavailable: item.experimentalRisk === null,
          experimentalRisk: item.experimentalRisk ? { ...item.experimentalRisk } : null,
          experimentalPolicyCurrent: item.experimentalPolicyCurrent,
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
      operationalClassificationUnavailable: result.operationalClassificationUnavailable,
      experimentalClassificationUnavailable: result.experimentalClassificationUnavailable,
      experimentalRiskPolicy: result.experimentalRiskPolicy
        ? {
            ...result.experimentalRiskPolicy,
            status: 'RESEARCH_PROVISIONAL',
            classificationBasis: 'RESEARCH_PROVISIONAL',
            operationalUseAllowed: false,
            notice: EXPERIMENTAL_RISK_NOTICE,
          }
        : null,
      sourceStatus: result.sourceStatus,
      predictiveStoreAvailable: result.predictiveStoreAvailable,
      requestId: request.id,
    };
  };
}
