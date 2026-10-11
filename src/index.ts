import 'reflect-metadata';
import { buildApp } from './app/BuildApp.js';
import {
  createMlHealthRegistration,
  createMlPredictionClient,
  createPredictiveDependencies,
} from './app/CreatePredictiveDependencies.js';
import { Server } from './app/Server.js';
import { Environment } from './config/environment/Environment.js';
import { createPredictiveConfig } from './config/PredictiveConfig.js';
import { mysqlSequelize } from './infrastructure/database/sequelize/mysql/MysqlClient.js';
import { postgresSequelize } from './infrastructure/database/sequelize/postgres/PostgresClient.js';
import { SequelizeHealthCheck } from './infrastructure/database/sequelize/SequelizeHealthCheck.js';
import { logger } from './infrastructure/logging/Logger.js';

const postgresHealthCheck = new SequelizeHealthCheck(postgresSequelize);
const mysqlHealthCheck = mysqlSequelize ? new SequelizeHealthCheck(mysqlSequelize) : null;

const predictiveConfig = createPredictiveConfig(Environment);
const mlClient = createMlPredictionClient(predictiveConfig.ml, logger);

if (!predictiveConfig.api.enabled) {
  logger.warn(
    { reason: predictiveConfig.api.disabledReason },
    'Rutas de negocio /api/v1 no registradas',
  );
}

const app = buildApp({
  postgresHealthCheck,
  mysqlHealthCheck,
  mlHealth: createMlHealthRegistration(predictiveConfig.ml, mlClient),
  predictiveApi:
    predictiveConfig.api.enabled && predictiveConfig.api.internalApiKeySha256
      ? {
          internalApiKeySha256: predictiveConfig.api.internalApiKeySha256,
          dependencies: createPredictiveDependencies(predictiveConfig, postgresSequelize, mlClient),
        }
      : null,
});

const server = new Server(app);

server.registerShutdownSignals();

await server.start();
