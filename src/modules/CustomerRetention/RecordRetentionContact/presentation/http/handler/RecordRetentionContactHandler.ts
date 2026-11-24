import type { FastifyReply, FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import { toRetentionContactBody } from '../../../../Shared/http/RetentionHttpMapper.js';
import type { RecordRetentionContact } from '../../../application/RecordRetentionContact.js';
import type { RecordRetentionContactRequest } from '../request/RecordRetentionContactRequest.js';
import type { RecordRetentionContactResponse } from '../response/RecordRetentionContactResponse.js';

export class RecordRetentionContactHandler {
  constructor(private readonly recordRetentionContact: RecordRetentionContact) {}

  readonly handle = async (
    request: FastifyRequest<RecordRetentionContactRequest>,
    reply: FastifyReply,
  ): Promise<RecordRetentionContactResponse> => {
    const result = await this.recordRetentionContact.execute({
      reservationId: request.params.reservationId,
      clientId: request.body.clientId,
      modelKey: request.body.modelKey,
      predictionRunId: request.body.predictionRunId.toLowerCase(),
      clinicScope: requirePrincipal(request).clinicScope,
      requestId: request.id,
    });

    // 201 si esta petición registró la acción; 200 en reintento idéntico (fecha original intacta).
    reply.status(result.replayed ? 200 : 201);
    return {
      data: { ...toRetentionContactBody(result.contact), replayed: result.replayed },
      requestId: request.id,
    };
  };
}
