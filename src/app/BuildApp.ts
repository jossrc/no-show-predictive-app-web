import fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { SequelizeHealthCheck } from '../infrastructure/database/sequelize/SequelizeHealthCheck.js';
import { logger } from '../infrastructure/logging/Logger.js';
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
  registerModules(app, {
    postgresHealthCheck: options.postgresHealthCheck,
    mysqlHealthCheck: options.mysqlHealthCheck,
    mlHealth: options.mlHealth,
    predictiveApi: options.predictiveApi,
  });

  return app;
}
