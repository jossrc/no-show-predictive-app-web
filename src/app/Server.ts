import type { FastifyInstance } from 'fastify';
import { appConfig } from '../config/AppConfig.js';
import { Environment } from '../config/environment/Environment.js';
import { mysqlSequelize } from '../infrastructure/database/sequelize/mysql/MysqlClient.js';
import { postgresSequelize } from '../infrastructure/database/sequelize/postgres/PostgresClient.js';
import { logger } from '../infrastructure/logging/Logger.js';

export class Server {
  private isShuttingDown = false;

  constructor(private readonly app: FastifyInstance) {}

  async start(): Promise<void> {
    try {
      const address = await this.app.listen({
        host: appConfig.host,
        port: appConfig.port,
      });

      logger.info(
        {
          address,
          environment: Environment.NODE_ENV,
          mysqlConfigured: mysqlSequelize !== null,
        },
        'Servidor iniciado',
      );
    } catch (error) {
      logger.fatal(
        {
          err: error,
        },
        'Error al iniciar el servidor',
      );

      await this.stop(1);
    }
  }

  async stop(exitCode = 0): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    logger.info('Cierre del servidor iniciado');

    try {
      await this.app.close();
      await postgresSequelize.close();

      if (mysqlSequelize) {
        await mysqlSequelize.close();
      }

      logger.info('Cierre del servidor completado');
    } catch (error) {
      logger.error(
        {
          err: error,
        },
        'Error al cerrar el servidor',
      );

      exitCode = 1;
    }

    process.exitCode = exitCode;
  }

  registerShutdownSignals(): void {
    process.once('SIGINT', () => void this.stop());

    process.once('SIGTERM', () => void this.stop());
  }
}
