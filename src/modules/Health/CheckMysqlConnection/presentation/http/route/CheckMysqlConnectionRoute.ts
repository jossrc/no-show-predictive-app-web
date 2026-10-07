import type { FastifyInstance } from 'fastify';
import { CheckDatabaseConnectionSchema } from '../../../../Shared/http/CheckDatabaseConnectionSchema.js';
import type { CheckDatabaseConnectionResponse } from '../../../../Shared/http/CheckDatabaseConnectionResponse.js';
import type { CheckMysqlConnectionHandler } from '../handler/CheckMysqlConnectionHandler.js';

interface CheckMysqlConnectionRoute {
  Reply: CheckDatabaseConnectionResponse;
}

export interface RegisterCheckMysqlConnectionRouteOptions {
  handler: CheckMysqlConnectionHandler;
}

export function registerCheckMysqlConnectionRoute(
  app: FastifyInstance,
  options: RegisterCheckMysqlConnectionRouteOptions,
): void {
  app.get<CheckMysqlConnectionRoute>(
    '/health/mysql',
    { schema: CheckDatabaseConnectionSchema },
    options.handler.handle,
  );
}
