import type { FastifyReply, FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import { toAttendanceOutcomeBody } from '../../../../Shared/http/OperationalHttpMapper.js';
import type { RecordAttendanceOutcome } from '../../../application/RecordAttendanceOutcome.js';
import type { RecordAttendanceOutcomeRequest } from '../request/RecordAttendanceOutcomeRequest.js';
import type { RecordAttendanceOutcomeResponse } from '../response/RecordAttendanceOutcomeResponse.js';

export class RecordAttendanceOutcomeHandler {
  constructor(private readonly recordAttendanceOutcome: RecordAttendanceOutcome) {}

  readonly handle = async (
    request: FastifyRequest<RecordAttendanceOutcomeRequest>,
    reply: FastifyReply,
  ): Promise<RecordAttendanceOutcomeResponse> => {
    const result = await this.recordAttendanceOutcome.execute({
      reservationId: request.params.reservationId,
      clinicScope: requirePrincipal(request).clinicScope,
      attendanceStatus: request.body.attendanceStatus,
      predictionRunId: request.body.predictionRunId.toLowerCase(),
      requestId: request.id,
    });

    reply.status(result.replayed ? 200 : 201);
    return {
      data: { ...toAttendanceOutcomeBody(result.outcome), replayed: result.replayed },
      requestId: request.id,
    };
  };
}
