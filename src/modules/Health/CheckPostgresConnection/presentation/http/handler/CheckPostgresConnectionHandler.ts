import type { FastifyReply } from 'fastify';
import type { CheckPostgresConnection } from '../../../application/CheckPostgresConnection.js';
import type { CheckDatabaseConnectionResponse } from '../../../../Shared/http/CheckDatabaseConnectionResponse.js';

export class CheckPostgresConnectionHandler {
  constructor(private readonly checkPostgresConnection: CheckPostgresConnection) {}

  readonly handle = async (
    _request: unknown,
    reply: FastifyReply,
  ): Promise<CheckDatabaseConnectionResponse> => {
    const result = await this.checkPostgresConnection.execute();

    if (result.status === 'error') {
      reply.status(503);
    }

    return result;
  };
}
