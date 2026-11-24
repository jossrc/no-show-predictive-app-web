import { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { toPriorityClientFilters } from '../../../../Shared/http/PriorityClientFilterQuery.js';
import type { ExportPriorityClients } from '../../../application/ExportPriorityClients.js';
import type { ExportPriorityClientsRequest } from '../request/ExportPriorityClientsRequest.js';

export class ExportPriorityClientsHandler {
  constructor(private readonly exportPriorityClients: ExportPriorityClients) {}

  readonly handle = async (
    request: FastifyRequest<ExportPriorityClientsRequest>,
    reply: FastifyReply,
  ): Promise<Readable> => {
    const result = await this.exportPriorityClients.execute({
      filters: toPriorityClientFilters(request.query, request),
      delimiter: request.query.delimiter,
    });
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${result.filename}"`)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff');
    return Readable.from(result.content);
  };
}
