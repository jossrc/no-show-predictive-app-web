import type { FastifyInstance } from 'fastify';
import type { SequelizeHealthCheck } from '../infrastructure/database/sequelize/SequelizeHealthCheck.js';
import { createHealthModule } from '../modules/Health/HealthModule.js';

export interface RegisterModulesOptions {
  postgresHealthCheck: SequelizeHealthCheck;
  mysqlHealthCheck: SequelizeHealthCheck | null;
}

export function registerModules(app: FastifyInstance, options: RegisterModulesOptions): void {
  app.register(
    async (api) => {
      await api.register(
        createHealthModule({
          postgresHealthCheck: options.postgresHealthCheck,
          mysqlHealthCheck: options.mysqlHealthCheck,
        }),
      );
    },
    {
      prefix: '/api',
    },
  );
}
