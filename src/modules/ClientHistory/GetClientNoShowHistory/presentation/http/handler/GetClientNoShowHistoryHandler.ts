import type { FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import type { GetClientNoShowHistory } from '../../../application/GetClientNoShowHistory.js';
import type { GetClientNoShowHistoryRequest } from '../request/GetClientNoShowHistoryRequest.js';
import type { GetClientNoShowHistoryResponse } from '../response/GetClientNoShowHistoryResponse.js';

export class GetClientNoShowHistoryHandler {
  constructor(private readonly getClientNoShowHistory: GetClientNoShowHistory) {}

  readonly handle = async (
    request: FastifyRequest<GetClientNoShowHistoryRequest>,
  ): Promise<GetClientNoShowHistoryResponse> => {
    const result = await this.getClientNoShowHistory.execute({
      reservationId: request.params.reservationId,
      historicalAsOf: request.query.historicalAsOf,
      clinicScope: requirePrincipal(request).clinicScope,
    });

    return {
      data: {
        reservationId: result.reservationId,
        clientId: result.clientId,
        historicalAsOf: result.historicalAsOf,
        cutoffAt: result.cutoffAt.toISOString(),
        cutoffSemantics: 'known_at < cutoffAt',
        historySemantics: result.historySemantics,
        previousAttended: result.previousAttended,
        previousNoShow: result.previousNoShow,
        resolvedTotal: result.resolvedTotal,
        noShowRate: result.noShowRate,
        lastNoShowAt: result.lastNoShowAt?.toISOString() ?? null,
        lastAttendedAt: result.lastAttendedAt?.toISOString() ?? null,
        warnings: [...result.warnings],
      },
      requestId: request.id,
    };
  };
}
