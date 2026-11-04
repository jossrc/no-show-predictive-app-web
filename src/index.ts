import 'reflect-metadata';
import { buildApp } from './app/BuildApp.js';
import {
  createMlHealthRegistration,
  createMlPredictionClient,
  createPredictiveDependencies,
  openPredictiveStore,
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

const businessRoutesEnabled =
  predictiveConfig.api.enabled && predictiveConfig.api.internalApiKeySha256 !== null;
// Almacén PostgreSQL de la app (ADR-008): se verifica al arrancar (base, rol, versión de esquema
// y modo). Cualquier discrepancia aborta el arranque: no hay fallback a SQLite ni a memoria.
// Las migraciones NO se aplican aquí (npm run store:migrate, rol migrador).
const predictiveStore = businessRoutesEnabled ? await openPredictiveStore(predictiveConfig) : null;
if (predictiveStore) {
  logger.info(
    {
      predictiveStore: await predictiveStore.health(),
      dataSourceMode: predictiveConfig.dataSourceMode,
      researchRiskEnabled: predictiveConfig.ml.researchRiskEnabled,
    },
    'Almacén predictivo PostgreSQL listo; fuente raw_flow/analytics en solo lectura',
  );
}

const app = buildApp({
  postgresHealthCheck,
  mysqlHealthCheck,
  mlHealth: createMlHealthRegistration(predictiveConfig.ml, mlClient),
  predictiveStore,
  predictiveApi:
    predictiveStore && predictiveConfig.api.internalApiKeySha256
      ? {
          internalApiKeySha256: predictiveConfig.api.internalApiKeySha256,
          dependencies: createPredictiveDependencies(
            predictiveConfig,
            postgresSequelize,
            mlClient,
            predictiveStore,
          ),
        }
      : null,
});
app.addHook('onClose', async () => predictiveStore?.close());

const server = new Server(app);

server.registerShutdownSignals();

await server.start();
