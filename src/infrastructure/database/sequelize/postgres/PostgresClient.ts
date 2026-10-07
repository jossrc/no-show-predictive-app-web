import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import { Environment } from '../../../../config/environment/Environment.js';
import { logSequelizeSql } from '../SequelizeLogging.js';

export const postgresSequelize = new Sequelize(
  Environment.DB_NAME_POSTGRES,
  Environment.DB_USER_POSTGRES,
  Environment.DB_PASS_POSTGRES,
  {
    host: Environment.DB_HOST_POSTGRES,
    port: Environment.DB_PORT_POSTGRES,
    dialect: 'postgres',
    logging: Environment.DATABASE_LOGGING ? logSequelizeSql : false,
    pool: {
      max: Environment.DATABASE_POOL_MAX,
      min: 0,
      acquire: Environment.DATABASE_CONNECTION_TIMEOUT_MS,
      idle: Environment.DATABASE_IDLE_TIMEOUT_MS,
    },
    define: {
      freezeTableName: true,
      underscored: true,
    },
    dialectOptions: {
      connectionTimeoutMillis: Environment.DATABASE_CONNECTION_TIMEOUT_MS,
    },
    models: [],
  },
);
