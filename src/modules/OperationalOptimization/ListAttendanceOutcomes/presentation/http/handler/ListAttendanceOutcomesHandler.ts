import type { FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import {
  toAttendanceOutcomeBody,
  toPeriodBody,
} from '../../../../Shared/http/OperationalHttpMapper.js';
import type { ListAttendanceOutcomes } from '../../../application/ListAttendanceOutcomes.js';
import type { ListAttendanceOutcomesRequest } from '../request/ListAttendanceOutcomesRequest.js';
import type { ListAttendanceOutcomesResponse } from '../response/ListAttendanceOutcomesResponse.js';

export class ListAttendanceOutcomesHandler {
  constructor(private readonly list: ListAttendanceOutcomes) {}

  readonly handle = async (
    request: FastifyRequest<ListAttendanceOutcomesRequest>,
  ): Promise<ListAttendanceOutcomesResponse> => {
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
      data: result.items.map(toAttendanceOutcomeBody),
      pagination: { limit: result.limit, nextCursor: result.nextCursor },
      period: toPeriodBody(result.period),
      requestId: request.id,
    };
  };
}
