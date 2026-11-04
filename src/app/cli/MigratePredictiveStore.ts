import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Environment } from '../../config/environment/Environment.js';
import {
  loadPredictiveAppMigrations,
  PredictiveAppMigrationRunner,
} from '../../infrastructure/database/postgres/PredictiveAppMigrationRunner.js';
import { cliErrorMessage, predictiveStoreClient } from './PredictiveStoreCliConnection.js';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations/postgres/predictive_app',
);

const HELP = `Uso: npm run store:migrate -- [--dry-run]

  --dry-run   Muestra base destino, migraciones aplicadas y pendientes en una sesión de SOLO
              LECTURA. No escribe.

Aplica SOLO migraciones aditivas (CREATE de objetos nuevos ml.app_*) de
migrations/postgres/predictive_app, cada una en su transacción con checksum y lock_timeout, y
liga la base al DATA_SOURCE_MODE actual. No existe "down" ni DROP/ALTER/DELETE/TRUNCATE.
Nunca toca raw_flow ni analytics.

Requiere el rol MIGRADOR (APP_DB_MIGRATOR_USER_POSTGRES / APP_DB_MIGRATOR_PASS_POSTGRES, ver
migrations/postgres/predictive_app/provisioning/roles.sql) y la autorización explícita
PREDICTIVE_STORE_MIGRATION_AUTHORIZED=true para escribir.`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }

  const dryRun = values['dry-run'] === true;
  if (!dryRun && process.env.PREDICTIVE_STORE_MIGRATION_AUTHORIZED !== 'true') {
    console.error(
      'store:migrate bloqueado: use --dry-run, o PREDICTIVE_STORE_MIGRATION_AUTHORIZED=true ' +
        'con autorización expresa del propietario de la base.',
    );
    process.exitCode = 2;
    return;
  }

  const client = predictiveStoreClient('migrator', dryRun);
  await client.connect();
  try {
    const runner = new PredictiveAppMigrationRunner(
      client,
      await loadPredictiveAppMigrations(MIGRATIONS_DIR),
    );
    const plan = await runner.plan();
    console.log(
      JSON.stringify(
        {
          database: plan.databaseName,
          applied: plan.applied,
          pending: plan.pending.map((migration) => `${migration.version}_${migration.name}`),
          dataSourceMode: Environment.DATA_SOURCE_MODE,
          dryRun,
        },
        null,
        2,
      ),
    );
    if (dryRun) return;

    const applied = await runner.up();
    const binding = await runner.bindIdentity(Environment.DATA_SOURCE_MODE);
    console.log(
      JSON.stringify({ applied, identity: binding, dataSourceMode: Environment.DATA_SOURCE_MODE }),
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Error en store:migrate:', cliErrorMessage(error));
  process.exitCode = 1;
});
