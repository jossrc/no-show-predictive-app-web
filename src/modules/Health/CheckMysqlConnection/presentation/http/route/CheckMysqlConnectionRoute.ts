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
    {
      schema: {
        ...CheckDatabaseConnectionSchema,
        summary: 'Consultar disponibilidad de MySQL',
        description:
          'Comprobación pública de la conexión opcional MySQL. La ruta permanece registrada y devuelve 200 con status=disabled cuando MySQL no está configurado.',
      },
    },
    options.handler.handle,
  );
}
