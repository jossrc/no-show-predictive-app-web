import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import mysql from 'mysql2/promise';
import pg from 'pg';
import { Environment } from '../../config/environment/Environment.js';
import { logger } from '../../infrastructure/logging/Logger.js';
import { flowTables, type FlowTable } from '../../modules/FlowMigration/FlowTables.js';
import {
  copyFlowTable,
  countFlowTable,
  planFlowTable,
  type FlowTableCounts,
  type FlowTablePlan,
} from '../../modules/FlowMigration/MigrateFlowTable.js';

const SCHEMA_SQL = new URL('../../../migrations/postgres/001-raw-flow.sql', import.meta.url);
const INDEXES_SQL = new URL(
  '../../../migrations/postgres/002-raw-flow-indexes.sql',
  import.meta.url,
);

const DEFAULT_BATCH_SIZE = 5000;

const help = `Migración única FLOWww -> PostgreSQL (raw_flow)

Uso:
  npm run migrate:flow -- [opciones]

Opciones:
  --only <tablas>       Solo estas tablas, separadas por coma (ej. clients,diary_gen)
  --limit <n>           Máximo de filas por tabla en esta corrida (prueba)
  --batch-size <n>      Filas por lote leído de MySQL (default ${DEFAULT_BATCH_SIZE})
  --fresh               Vacía las tablas destino antes de copiar
  --help                Muestra esta ayuda

Tablas: ${flowTables.map((table) => table.name).join(', ')}

Si se interrumpe, volver a ejecutar continúa desde la última fila copiada.`;

interface MigrateFlowArgs {
  tables: readonly FlowTable[];
  limit: number | null;
  batchSize: number;
  fresh: boolean;
}

function parsePositiveInteger(value: string | undefined, option: string): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} debe ser un entero positivo`);
  }

  return parsed;
}

function parseMigrateFlowArgs(): MigrateFlowArgs | null {
  const { values } = parseArgs({
    options: {
      only: { type: 'string' },
      limit: { type: 'string' },
      'batch-size': { type: 'string' },
      fresh: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    return null;
  }

  let tables = flowTables;

  if (values.only !== undefined) {
    const requested = values.only
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const unknown = requested.filter((name) => !flowTables.some((table) => table.name === name));

    if (unknown.length > 0) {
      throw new Error(`Tablas desconocidas: ${unknown.join(', ')}`);
    }

    tables = flowTables.filter((table) => requested.includes(table.name));
  }

  return {
    tables,
    limit: parsePositiveInteger(values.limit, '--limit'),
    batchSize: parsePositiveInteger(values['batch-size'], '--batch-size') ?? DEFAULT_BATCH_SIZE,
    fresh: values.fresh,
  };
}

async function connectMysql(): Promise<mysql.Connection> {
  const host = Environment.DB_HOST_MYSQL;
  const user = Environment.DB_USER_MYSQL;
  const database = Environment.DB_NAME_MYSQL;

  if (!host || !user || !database) {
    throw new Error('Configura DB_HOST_MYSQL, DB_USER_MYSQL y DB_NAME_MYSQL en .env');
  }

  return mysql.createConnection({
    host,
    port: Environment.DB_PORT_MYSQL,
    user,
    password: Environment.DB_PASS_MYSQL,
    database,
    connectTimeout: Environment.DATABASE_CONNECTION_TIMEOUT_MS,
    // Fechas como texto: se copian tal cual a timestamp without time zone, sin conversión horaria.
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
}

async function connectPostgres(): Promise<pg.Client> {
  const client = new pg.Client({
    host: Environment.DB_HOST_POSTGRES,
    port: Environment.DB_PORT_POSTGRES,
    user: Environment.DB_USER_POSTGRES,
    password: Environment.DB_PASS_POSTGRES,
    database: Environment.DB_NAME_POSTGRES,
    connectionTimeoutMillis: Environment.DATABASE_CONNECTION_TIMEOUT_MS,
  });

  await client.connect();
  return client;
}

async function truncateTargets(postgres: pg.Client, tables: readonly FlowTable[]): Promise<void> {
  const targets = tables.map((table) => `raw_flow."${table.name}"`);

  if (tables.length === flowTables.length) {
    targets.push('raw_flow.ingestion_batches');
  }

  await postgres.query(`TRUNCATE ${targets.join(', ')} RESTART IDENTITY`);
  logger.warn({ tables: tables.map((table) => table.name) }, 'Tablas destino vaciadas (--fresh)');
}

async function openIngestionBatch(postgres: pg.Client, args: MigrateFlowArgs): Promise<number> {
  const result = await postgres.query<{ batch_id: string }>(
    `INSERT INTO raw_flow.ingestion_batches (source_type, source_name, dataset_date, notes)
     VALUES ('DIRECT_MYSQL', 'initial_flowww_load', current_date, $1)
     RETURNING batch_id`,
    [JSON.stringify({ tables: args.tables.map((t) => t.name), limit: args.limit })],
  );

  return Number(result.rows[0]?.batch_id);
}

async function closeIngestionBatch(
  postgres: pg.Client,
  batchId: number,
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED',
  rowCounts: Record<string, unknown>,
  errorMessage: string | null,
): Promise<void> {
  await postgres.query(
    `UPDATE raw_flow.ingestion_batches
        SET status = $2, finished_at = now(), row_counts = $3, error_message = $4
      WHERE batch_id = $1`,
    [batchId, status, JSON.stringify(rowCounts), errorMessage],
  );
}

async function run(args: MigrateFlowArgs): Promise<void> {
  let stopRequested = false;

  process.on('SIGINT', () => {
    if (stopRequested) {
      process.exit(130);
    }

    stopRequested = true;
    logger.warn('Deteniendo al terminar el lote actual (Ctrl+C otra vez para forzar)');
  });

  const postgres = await connectPostgres();
  let source: mysql.Connection | null = null;
  let batchId: number | null = null;
  const rowCounts: Record<string, unknown> = {};

  try {
    source = await connectMysql();
    logger.info('Conexiones a MySQL y PostgreSQL abiertas');

    await postgres.query(await readFile(SCHEMA_SQL, 'utf8'));

    const plans: FlowTablePlan[] = [];

    for (const table of args.tables) {
      plans.push(await planFlowTable(source, postgres, table));
    }

    logger.info({ tables: plans.length }, 'Columnas validadas en MySQL y PostgreSQL');

    if (args.fresh) {
      await truncateTargets(postgres, args.tables);
    }

    batchId = await openIngestionBatch(postgres, args);
    let allCompleted = true;

    for (const plan of plans) {
      const startedAt = Date.now();
      const result = await copyFlowTable(source, postgres, plan, {
        batchId,
        batchSize: args.batchSize,
        limit: args.limit,
        shouldStop: () => stopRequested,
      });

      let counts: FlowTableCounts | null = null;

      if (result.completed) {
        counts = await countFlowTable(source, postgres, plan.table);
      } else {
        allCompleted = false;
      }

      rowCounts[plan.table.name] = { read: result.read, inserted: result.inserted, ...counts };

      const summary = {
        table: plan.table.name,
        read: result.read,
        inserted: result.inserted,
        completed: result.completed,
        ...(counts && { mysqlCount: counts.mysql, postgresCount: counts.postgres }),
        seconds: Math.round((Date.now() - startedAt) / 1000),
      };

      if (counts && counts.mysql !== counts.postgres) {
        logger.warn(summary, 'Tabla copiada con conteos distintos entre MySQL y PostgreSQL');
      } else {
        logger.info(summary, result.completed ? 'Tabla copiada' : 'Tabla pausada');
      }

      if (stopRequested) {
        allCompleted = false;
        break;
      }
    }

    const status = allCompleted && args.limit === null ? 'COMPLETED' : 'PARTIAL';

    if (status === 'COMPLETED') {
      logger.info('Creando índices de raw_flow');
      await postgres.query(await readFile(INDEXES_SQL, 'utf8'));
    }

    await closeIngestionBatch(postgres, batchId, status, rowCounts, null);
    logger.info({ batchId, status }, 'Migración finalizada');
  } catch (error) {
    if (batchId !== null) {
      const message = error instanceof Error ? error.message : String(error);
      await closeIngestionBatch(postgres, batchId, 'FAILED', rowCounts, message).catch(() => {});
    }

    throw error;
  } finally {
    await source?.end();
    await postgres.end();
  }
}

try {
  const args = parseMigrateFlowArgs();

  if (args === null) {
    console.log(help);
  } else if (process.env.FLOW_MIGRATION_WRITE_AUTHORIZED !== 'true') {
    // ADR-006: raw_flow es la réplica fuente de solo lectura; recargarla exige autorización expresa.
    console.error(
      'migrate:flow bloqueado: escribe raw_flow en PostgreSQL. Requiere ' +
        'FLOW_MIGRATION_WRITE_AUTHORIZED=true con autorización expresa del propietario.',
    );
    process.exitCode = 2;
  } else {
    await run(args);
  }
} catch (error) {
  logger.fatal({ err: error }, 'La migración falló');
  process.exitCode = 1;
}
