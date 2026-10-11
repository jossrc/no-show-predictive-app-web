import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { Environment } from '../../config/environment/Environment.js';
import {
  AppMigrationRunner,
  loadAppMigrations,
} from '../../infrastructure/database/migrations/AppMigrationRunner.js';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations/postgres/app',
);

const HELP = `Uso: npm run migrate:app -- [--dry-run] [--down --confirm-database=<nombre>]

  --dry-run            Muestra base destino, migraciones aplicadas y pendientes; no escribe.
  --down               Revierte la última migración. SOLO en bases desechables (test/synthetic/demo)
                       y con --confirm-database igual al nombre de la base conectada.

Solo afecta al schema propio "ml". Nunca modifica raw_flow ni analytics.`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      down: { type: 'boolean', default: false },
      'confirm-database': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  const client = new pg.Client({
    host: Environment.DB_HOST_POSTGRES,
    port: Environment.DB_PORT_POSTGRES,
    user: Environment.DB_USER_POSTGRES,
    password: Environment.DB_PASS_POSTGRES,
    database: Environment.DB_NAME_POSTGRES,
    connectionTimeoutMillis: Environment.DATABASE_CONNECTION_TIMEOUT_MS,
  });
  await client.connect();

  try {
    const runner = new AppMigrationRunner(client, await loadAppMigrations(MIGRATIONS_DIR));
    const plan = await runner.plan();
    console.log(
      JSON.stringify(
        {
          database: plan.databaseName,
          applied: plan.applied,
          pending: plan.pending.map((migration) => `${migration.version}_${migration.name}`),
          dryRun: values['dry-run'],
        },
        null,
        2,
      ),
    );

    if (values['dry-run']) return;

    if (values.down) {
      const reverted = await runner.downLatest(values['confirm-database'] ?? '');
      console.log(reverted ? `Revertida ${reverted}` : 'No hay migraciones aplicadas');
      return;
    }

    const applied = await runner.up();
    console.log(
      applied.length > 0 ? `Aplicadas: ${applied.join(', ')}` : 'Sin migraciones pendientes',
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Error en migrate:app:', error instanceof Error ? error.message : 'desconocido');
  process.exitCode = 1;
});
