import fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { SequelizeHealthCheck } from '../infrastructure/database/sequelize/SequelizeHealthCheck.js';
import { logger } from '../infrastructure/logging/Logger.js';
import { registerErrorHandler } from './http/errors/RegisterErrorHandler.js';
import type { ExceptionReporter } from './http/errors/reporting/ExceptionReporter.js';
import { registerModules } from './RegisterModules.js';

export interface BuildAppOptions {
  postgresHealthCheck: SequelizeHealthCheck;
  mysqlHealthCheck: SequelizeHealthCheck | null;
  exceptionReporters?: readonly ExceptionReporter[];
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = fastify({
    loggerInstance: logger as FastifyBaseLogger,
    genReqId: () => randomUUID(),
    ajv: {
      customOptions: {
        allErrors: true,
        removeAdditional: false,
      },
    },
  });

  registerErrorHandler(app, { reporters: options.exceptionReporters });
  registerModules(app, {
    postgresHealthCheck: options.postgresHealthCheck,
    mysqlHealthCheck: options.mysqlHealthCheck,
  });

  return app;
}
