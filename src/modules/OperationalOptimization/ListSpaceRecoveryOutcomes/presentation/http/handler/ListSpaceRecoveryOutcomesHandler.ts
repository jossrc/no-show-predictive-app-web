import type { FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import {
  toSpaceRecoveryOutcomeBody,
  toPeriodBody,
} from '../../../../Shared/http/OperationalHttpMapper.js';
import type { ListSpaceRecoveryOutcomes } from '../../../application/ListSpaceRecoveryOutcomes.js';
import type { ListSpaceRecoveryOutcomesRequest } from '../request/ListSpaceRecoveryOutcomesRequest.js';
import type { ListSpaceRecoveryOutcomesResponse } from '../response/ListSpaceRecoveryOutcomesResponse.js';

export class ListSpaceRecoveryOutcomesHandler {
  constructor(private readonly list: ListSpaceRecoveryOutcomes) {}

  readonly handle = async (
    request: FastifyRequest<ListSpaceRecoveryOutcomesRequest>,
  ): Promise<ListSpaceRecoveryOutcomesResponse> => {
    const query = request.query;
    const result = await this.list.execute({
      from: query.from,
      to: query.to,
      clinicId: query.clinicId === undefined ? null : Number(query.clinicId),
      limit: query.limit,
      cursor: query.cursor ?? null,
      clinicScope: requirePrincipal(request).clinicScope,
    });
    return {
      data: result.items.map(toSpaceRecoveryOutcomeBody),
      pagination: { limit: result.limit, nextCursor: result.nextCursor },
      period: toPeriodBody(result.period),
      requestId: request.id,
    };
  };
}
