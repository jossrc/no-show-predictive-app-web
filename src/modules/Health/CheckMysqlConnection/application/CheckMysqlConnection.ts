import type { SequelizeHealthCheck } from '../../../../infrastructure/database/sequelize/SequelizeHealthCheck.js';
import {
  getConnectionErrorMessage,
  type CheckDatabaseConnectionResult,
} from '../../Shared/CheckDatabaseConnectionResult.js';

export class CheckMysqlConnection {
  constructor(private readonly sequelizeHealthCheck: SequelizeHealthCheck | null) {}

  async execute(): Promise<CheckDatabaseConnectionResult> {
    if (!this.sequelizeHealthCheck) {
      return {
        database: 'mysql',
        status: 'disabled',
        message: 'Conexión a MySQL no configurada',
      };
    }

    try {
      await this.sequelizeHealthCheck.check();

      return {
        database: 'mysql',
        status: 'ok',
        message: 'Conexión a MySQL verificada',
      };
    } catch (error) {
      return {
        database: 'mysql',
        status: 'error',
        message: getConnectionErrorMessage(error),
      };
    }
  }
}
