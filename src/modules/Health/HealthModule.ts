import type { FastifyPluginAsync } from 'fastify';
import type { SequelizeHealthCheck } from '../../infrastructure/database/sequelize/SequelizeHealthCheck.js';
import type { MlPredictionClient } from '../../infrastructure/http/ml/MlPredictionClient.js';
import { CheckMlService } from './CheckMlService/application/CheckMlService.js';
import { CheckMlServiceHandler } from './CheckMlService/presentation/http/handler/CheckMlServiceHandler.js';
import { registerCheckMlServiceRoute } from './CheckMlService/presentation/http/route/CheckMlServiceRoute.js';
import { CheckMysqlConnection } from './CheckMysqlConnection/application/CheckMysqlConnection.js';
import { CheckMysqlConnectionHandler } from './CheckMysqlConnection/presentation/http/handler/CheckMysqlConnectionHandler.js';
import { registerCheckMysqlConnectionRoute } from './CheckMysqlConnection/presentation/http/route/CheckMysqlConnectionRoute.js';
import { CheckPostgresConnection } from './CheckPostgresConnection/application/CheckPostgresConnection.js';
import { CheckPostgresConnectionHandler } from './CheckPostgresConnection/presentation/http/handler/CheckPostgresConnectionHandler.js';
import { registerCheckPostgresConnectionRoute } from './CheckPostgresConnection/presentation/http/route/CheckPostgresConnectionRoute.js';

export interface HealthModuleOptions {
  postgresHealthCheck: SequelizeHealthCheck;
  mysqlHealthCheck: SequelizeHealthCheck | null;
  /** Opcional: si se omite, /v1/health/ml no se registra. */
  mlHealth?: { client: Pick<MlPredictionClient, 'ready'>; configured: boolean } | undefined;
}

export function createHealthModule(options: HealthModuleOptions): FastifyPluginAsync {
  return async (app): Promise<void> => {
    const checkPostgresConnection = new CheckPostgresConnection(options.postgresHealthCheck);
    const checkPostgresConnectionHandler = new CheckPostgresConnectionHandler(
      checkPostgresConnection,
    );

    const checkMysqlConnection = new CheckMysqlConnection(options.mysqlHealthCheck);
    const checkMysqlConnectionHandler = new CheckMysqlConnectionHandler(checkMysqlConnection);

    registerCheckPostgresConnectionRoute(app, {
      handler: checkPostgresConnectionHandler,
    });
    registerCheckMysqlConnectionRoute(app, {
      handler: checkMysqlConnectionHandler,
    });

    if (options.mlHealth) {
      const checkMlService = new CheckMlService(
        options.mlHealth.client,
        options.mlHealth.configured,
      );
      registerCheckMlServiceRoute(app, { handler: new CheckMlServiceHandler(checkMlService) });
    }
  };
}
