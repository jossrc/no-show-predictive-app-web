import 'reflect-metadata';
import { buildApp } from './app/BuildApp.js';
import { Server } from './app/Server.js';
import { mysqlSequelize } from './infrastructure/database/sequelize/mysql/MysqlClient.js';
import { postgresSequelize } from './infrastructure/database/sequelize/postgres/PostgresClient.js';
import { SequelizeHealthCheck } from './infrastructure/database/sequelize/SequelizeHealthCheck.js';

const postgresHealthCheck = new SequelizeHealthCheck(postgresSequelize);
const mysqlHealthCheck = mysqlSequelize ? new SequelizeHealthCheck(mysqlSequelize) : null;

const app = buildApp({
  postgresHealthCheck,
  mysqlHealthCheck,
});

const server = new Server(app);

server.registerShutdownSignals();

await server.start();
