import fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { Environment } from '../config/environment/Environment.js';
import type { SequelizeHealthCheck } from '../infrastructure/database/sequelize/SequelizeHealthCheck.js';
import { logger } from '../infrastructure/logging/Logger.js';
import { registerOpenApi } from './http/documentation/RegisterOpenApi.js';
import { registerScalar } from './http/documentation/RegisterScalar.js';
import { registerErrorHandler } from './http/errors/RegisterErrorHandler.js';
import type { ExceptionReporter } from './http/errors/reporting/ExceptionReporter.js';
import { REQUEST_ID_HEADER, resolveRequestId } from './http/request/ResolveRequestId.js';
import type {
  MlHealthRegistration,
  PredictiveApiRegistration,
} from './PredictiveModulesDependencies.js';
import { registerModules } from './RegisterModules.js';

/** Límite global de cuerpo: 413 antes de deserializar cargas grandes (no hay uploads en Sprint 01). */
export const MAX_BODY_BYTES = 64 * 1024;

export interface BuildAppOptions {
  postgresHealthCheck: SequelizeHealthCheck;
  mysqlHealthCheck: SequelizeHealthCheck | null;
  exceptionReporters?: readonly ExceptionReporter[];
  mlHealth?: MlHealthRegistration | undefined;
  predictiveApi?: PredictiveApiRegistration | null | undefined;
  loggerInstance?: FastifyBaseLogger | undefined;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = fastify({
    loggerInstance: options.loggerInstance ?? (logger as FastifyBaseLogger),
    genReqId: resolveRequestId,
    bodyLimit: MAX_BODY_BYTES,
    ajv: {
      customOptions: {
        allErrors: true,
        removeAdditional: false,
      },
    },
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });

  registerErrorHandler(app, { reporters: options.exceptionReporters });
  // El generador precede a las rutas; la documentación queda fuera de la compuerta /api/v1.
  if (Environment.NODE_ENV === 'development') {
    registerOpenApi(app);
  }
  registerModules(app, {
    postgresHealthCheck: options.postgresHealthCheck,
    mysqlHealthCheck: options.mysqlHealthCheck,
    mlHealth: options.mlHealth,
    predictiveApi: options.predictiveApi,
  });
  if (Environment.NODE_ENV === 'development') {
    registerScalar(app);
  }

  return app;
}
