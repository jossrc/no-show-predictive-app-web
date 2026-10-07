import type { FastifyInstance } from 'fastify';
import { CheckDatabaseConnectionSchema } from '../../../../Shared/http/CheckDatabaseConnectionSchema.js';
import type { CheckDatabaseConnectionResponse } from '../../../../Shared/http/CheckDatabaseConnectionResponse.js';
import type { CheckPostgresConnectionHandler } from '../handler/CheckPostgresConnectionHandler.js';

interface CheckPostgresConnectionRoute {
  Reply: CheckDatabaseConnectionResponse;
}

export interface RegisterCheckPostgresConnectionRouteOptions {
  handler: CheckPostgresConnectionHandler;
}

export function registerCheckPostgresConnectionRoute(
  app: FastifyInstance,
  options: RegisterCheckPostgresConnectionRouteOptions,
): void {
  app.get<CheckPostgresConnectionRoute>(
    '/health/postgres',
    { schema: CheckDatabaseConnectionSchema },
    options.handler.handle,
  );
}
