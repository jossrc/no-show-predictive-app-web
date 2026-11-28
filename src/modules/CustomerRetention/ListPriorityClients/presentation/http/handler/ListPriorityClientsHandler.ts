import type { FastifyRequest } from 'fastify';
import type { RiskLevelPolicy } from '../../../../../ReservationRisk/Shared/policy/RiskLevelPolicy.js';
import {
  toPriorityClientBody,
  toQueryContextBody,
} from '../../../../Shared/http/RetentionHttpMapper.js';
import { toPriorityClientFilters } from '../../../../Shared/http/PriorityClientFilterQuery.js';
import type { ListPriorityClients } from '../../../application/ListPriorityClients.js';
import type { ListPriorityClientsRequest } from '../request/ListPriorityClientsRequest.js';
import type { ListPriorityClientsResponse } from '../response/ListPriorityClientsResponse.js';

export class ListPriorityClientsHandler {
  constructor(
    private readonly listPriorityClients: ListPriorityClients,
    private readonly policy: Pick<RiskLevelPolicy, 'status'>,
  ) {}

  readonly handle = async (
    request: FastifyRequest<ListPriorityClientsRequest>,
  ): Promise<ListPriorityClientsResponse> => {
    const result = await this.listPriorityClients.execute({
      filters: toPriorityClientFilters(request.query, request),
      limit: request.query.limit,
      cursor: request.query.cursor ?? null,
    });
    return {
      data: result.items.map(toPriorityClientBody),
      pagination: { limit: result.limit, nextCursor: result.nextCursor },
      ...toQueryContextBody(result.query),
      riskPolicyStatus: this.policy.status,
      predictiveStoreAvailable: result.predictiveStoreAvailable,
      requestId: request.id,
    };
  };
}
