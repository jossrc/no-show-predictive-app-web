import type { SequelizeHealthCheck } from '../../../../infrastructure/database/sequelize/SequelizeHealthCheck.js';
import {
  getConnectionErrorMessage,
  type CheckDatabaseConnectionResult,
} from '../../Shared/CheckDatabaseConnectionResult.js';

export class CheckPostgresConnection {
  constructor(private readonly sequelizeHealthCheck: SequelizeHealthCheck) {}

  async execute(): Promise<CheckDatabaseConnectionResult> {
    try {
      await this.sequelizeHealthCheck.check();

      return {
        database: 'postgres',
        status: 'ok',
        message: 'Conexión a PostgreSQL verificada',
      };
    } catch (error) {
      return {
        database: 'postgres',
        status: 'error',
        message: getConnectionErrorMessage(error),
      };
    }
  }
}
