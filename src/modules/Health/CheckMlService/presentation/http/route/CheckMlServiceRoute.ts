import type { FastifyInstance } from 'fastify';
import type { CheckMlServiceHandler } from '../handler/CheckMlServiceHandler.js';
import type { CheckMlServiceResponse } from '../response/CheckMlServiceResponse.js';
import { CheckMlServiceSchema } from '../schema/CheckMlServiceSchema.js';

export interface RegisterCheckMlServiceRouteOptions {
  handler: CheckMlServiceHandler;
}

export function registerCheckMlServiceRoute(
  app: FastifyInstance,
  options: RegisterCheckMlServiceRouteOptions,
): void {
  app.get<{ Reply: CheckMlServiceResponse }>(
    '/v1/health/ml',
    { schema: CheckMlServiceSchema },
    options.handler.handle,
  );
}
