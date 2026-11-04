import type { FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import {
  toAuthorizationBody,
  toPeriodBody,
} from '../../../../Shared/http/OperationalHttpMapper.js';
import type { ListOverbookingAuthorizations } from '../../../application/ListOverbookingAuthorizations.js';
import type { ListOverbookingAuthorizationsRequest } from '../request/ListOverbookingAuthorizationsRequest.js';
import type { ListOverbookingAuthorizationsResponse } from '../response/ListOverbookingAuthorizationsResponse.js';

export class ListOverbookingAuthorizationsHandler {
  constructor(private readonly list: ListOverbookingAuthorizations) {}

  readonly handle = async (
    request: FastifyRequest<ListOverbookingAuthorizationsRequest>,
  ): Promise<ListOverbookingAuthorizationsResponse> => {
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
      data: result.items.map(toAuthorizationBody),
      pagination: { limit: result.limit, nextCursor: result.nextCursor },
      period: toPeriodBody(result.period),
      requestId: request.id,
    };
  };
}
