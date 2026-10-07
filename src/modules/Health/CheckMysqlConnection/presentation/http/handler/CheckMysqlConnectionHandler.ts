import type { FastifyReply } from 'fastify';
import type { CheckMysqlConnection } from '../../../application/CheckMysqlConnection.js';
import type { CheckDatabaseConnectionResponse } from '../../../../Shared/http/CheckDatabaseConnectionResponse.js';

export class CheckMysqlConnectionHandler {
  constructor(private readonly checkMysqlConnection: CheckMysqlConnection) {}

  readonly handle = async (
    _request: unknown,
    reply: FastifyReply,
  ): Promise<CheckDatabaseConnectionResponse> => {
    const result = await this.checkMysqlConnection.execute();

    if (result.status === 'error') {
      reply.status(503);
    }

    return result;
  };
}
