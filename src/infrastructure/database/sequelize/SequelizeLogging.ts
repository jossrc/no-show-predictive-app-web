import { logger } from '../../logging/Logger.js';

export function logSequelizeSql(sql: string): void {
  logger.debug({ sql }, 'Sequelize');
}

export function logSequelizeSyncSql(sql: string): void {
  logger.info({ sql }, 'Sequelize sync');
}
