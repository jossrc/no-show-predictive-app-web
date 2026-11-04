import type { FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import { toAttendanceOutcomeBody } from '../../../../Shared/http/OperationalHttpMapper.js';
import type { GetAttendanceOutcome } from '../../../application/GetAttendanceOutcome.js';
import type { GetAttendanceOutcomeRequest } from '../request/GetAttendanceOutcomeRequest.js';
import type { GetAttendanceOutcomeResponse } from '../response/GetAttendanceOutcomeResponse.js';

export class GetAttendanceOutcomeHandler {
  constructor(private readonly getAttendanceOutcome: GetAttendanceOutcome) {}

  readonly handle = async (
    request: FastifyRequest<GetAttendanceOutcomeRequest>,
  ): Promise<GetAttendanceOutcomeResponse> => {
    const result = await this.getAttendanceOutcome.execute({
      reservationId: request.params.reservationId,
      clinicScope: requirePrincipal(request).clinicScope,
    });
    return {
      data: {
        reservationId: result.reservationId,
        recorded: result.outcome !== null,
        attendanceStatus: result.outcome?.attendanceStatus ?? null,
        outcome: result.outcome ? toAttendanceOutcomeBody(result.outcome) : null,
        registration: {
          ...result.registration,
          availablePredictionRunIds: [...result.registration.availablePredictionRunIds],
        },
      },
      requestId: request.id,
    };
  };
}
