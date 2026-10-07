import type { Connection, RowDataPacket } from 'mysql2/promise';
import type pg from 'pg';
import { logger } from '../../infrastructure/logging/Logger.js';
import type { FlowTable } from './FlowTables.js';

// PostgreSQL admite hasta 65 535 parámetros por sentencia.
const MAX_POSTGRES_PARAMS = 65_000;
const PROGRESS_LOG_EVERY_ROWS = 50_000;

const DATE_TYPES = new Set(['date', 'timestamp without time zone', 'timestamp with time zone']);
const INVALID_MYSQL_DATE = /^(0000-|\d{4}-00-|\d{4}-\d{2}-00)/;

type SourceKey = string | number;

export interface TargetColumn {
  readonly name: string;
  readonly dataType: string;
}

export interface FlowTablePlan {
  readonly table: FlowTable;
  readonly columns: readonly TargetColumn[];
}

export interface CopyFlowTableOptions {
  readonly batchId: number;
  readonly batchSize: number;
  readonly limit: number | null;
  readonly shouldStop: () => boolean;
}

export interface CopyFlowTableResult {
  readonly table: string;
  readonly read: number;
  readonly inserted: number;
  readonly resumedAfter: SourceKey | null;
  readonly completed: boolean;
}

export interface FlowTableCounts {
  readonly mysql: number;
  readonly postgres: number;
}

function quotePostgres(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteMysql(identifier: string): string {
  return `\`${identifier.replaceAll('`', '``')}\``;
}

function targetTable(table: FlowTable): string {
  return `raw_flow.${quotePostgres(table.name)}`;
}

function toPostgresValue(value: unknown, column: TargetColumn): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = Buffer.isBuffer(value) ? value.toString('utf8') : value;

  if (typeof normalized !== 'string') {
    return normalized;
  }

  if (DATE_TYPES.has(column.dataType) && INVALID_MYSQL_DATE.test(normalized)) {
    return null;
  }

  // PostgreSQL rechaza el carácter NUL dentro de text/varchar.
  return normalized.includes('\u0000') ? normalized.replaceAll('\u0000', '') : normalized;
}

export async function planFlowTable(
  mysql: Connection,
  postgres: pg.Client,
  table: FlowTable,
): Promise<FlowTablePlan> {
  const target = await postgres.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'raw_flow'
        AND table_name = $1
        AND column_name NOT IN ('_ingested_at', '_ingestion_batch_id')
      ORDER BY ordinal_position`,
    [table.name],
  );

  if (target.rows.length === 0) {
    throw new Error(`raw_flow.${table.name} no existe en PostgreSQL`);
  }

  const columns = target.rows.map((row) => ({ name: row.column_name, dataType: row.data_type }));

  if (!columns.some((column) => column.name === table.primaryKey)) {
    throw new Error(`raw_flow.${table.name} no tiene la columna clave ${table.primaryKey}`);
  }

  const [source] = await mysql.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME AS name
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table.name],
  );

  if (source.length === 0) {
    throw new Error(
      `La tabla ${table.name} no existe en MySQL o la cuenta no tiene SELECT sobre ella`,
    );
  }

  const sourceColumns = new Set(source.map((row) => String(row['name']).toLowerCase()));
  const missing = columns.filter((column) => !sourceColumns.has(column.name.toLowerCase()));

  if (missing.length > 0) {
    throw new Error(
      `${table.name}: columnas inexistentes en MySQL: ${missing.map((c) => c.name).join(', ')}`,
    );
  }

  return { table, columns };
}

async function readLastCopiedKey(postgres: pg.Client, table: FlowTable): Promise<SourceKey | null> {
  const result = await postgres.query<{ last_key: SourceKey | null }>(
    `SELECT max(${quotePostgres(table.primaryKey)}) AS last_key FROM ${targetTable(table)}`,
  );

  return result.rows[0]?.last_key ?? null;
}

async function readSourceBatch(
  mysql: Connection,
  plan: FlowTablePlan,
  after: SourceKey | null,
  size: number,
): Promise<unknown[][]> {
  const { table, columns } = plan;
  const select = `SELECT ${columns.map((c) => quoteMysql(c.name)).join(', ')} FROM ${quoteMysql(table.name)}`;
  const key = quoteMysql(table.primaryKey);

  const sql =
    after === null
      ? `${select} ORDER BY ${key} LIMIT ?`
      : `${select} WHERE ${key} > ? ORDER BY ${key} LIMIT ?`;

  const params = after === null ? [size] : [after, size];
  const [rows] = await mysql.query<RowDataPacket[]>({ sql, rowsAsArray: true }, params);

  return rows as unknown as unknown[][];
}

async function insertTargetRows(
  postgres: pg.Client,
  plan: FlowTablePlan,
  rows: readonly unknown[][],
  batchId: number,
): Promise<number> {
  const { table, columns } = plan;
  const columnList = [...columns.map((c) => quotePostgres(c.name)), '"_ingestion_batch_id"'];
  const rowsPerStatement = Math.max(1, Math.floor(MAX_POSTGRES_PARAMS / columnList.length));
  let inserted = 0;

  for (let start = 0; start < rows.length; start += rowsPerStatement) {
    const chunk = rows.slice(start, start + rowsPerStatement);
    const params: unknown[] = [];

    const tuples = chunk.map((row) => {
      const placeholders = columns.map((column, index) => {
        params.push(toPostgresValue(row[index], column));
        return `$${params.length}`;
      });

      params.push(batchId);
      placeholders.push(`$${params.length}`);

      return `(${placeholders.join(', ')})`;
    });

    const result = await postgres.query(
      `INSERT INTO ${targetTable(table)} (${columnList.join(', ')})
       VALUES ${tuples.join(', ')}
       ON CONFLICT (${quotePostgres(table.primaryKey)}) DO NOTHING`,
      params,
    );

    inserted += result.rowCount ?? 0;
  }

  return inserted;
}

export async function copyFlowTable(
  mysql: Connection,
  postgres: pg.Client,
  plan: FlowTablePlan,
  options: CopyFlowTableOptions,
): Promise<CopyFlowTableResult> {
  const { table, columns } = plan;
  const keyIndex = columns.findIndex((column) => column.name === table.primaryKey);
  const resumedAfter = await readLastCopiedKey(postgres, table);

  let cursor = resumedAfter;
  let read = 0;
  let inserted = 0;
  let nextProgressLog = PROGRESS_LOG_EVERY_ROWS;

  logger.info(
    { table: table.name, resumedAfter },
    resumedAfter === null ? 'Copiando tabla' : 'Reanudando tabla',
  );

  const result = (completed: boolean): CopyFlowTableResult => ({
    table: table.name,
    read,
    inserted,
    resumedAfter,
    completed,
  });

  while (true) {
    if (options.shouldStop()) {
      return result(false);
    }

    const size =
      options.limit === null
        ? options.batchSize
        : Math.min(options.batchSize, options.limit - read);

    if (size <= 0) {
      return result(false);
    }

    const rows = await readSourceBatch(mysql, plan, cursor, size);

    if (rows.length === 0) {
      return result(true);
    }

    const firstKey = rows[0]?.[keyIndex] as SourceKey;
    const lastKey = rows[rows.length - 1]?.[keyIndex] as SourceKey;

    try {
      inserted += await insertTargetRows(postgres, plan, rows, options.batchId);
    } catch (error) {
      throw new Error(
        `${table.name}: falló la inserción de ${table.primaryKey} ${firstKey}..${lastKey}`,
        { cause: error },
      );
    }

    read += rows.length;
    cursor = lastKey;

    if (read >= nextProgressLog) {
      logger.info({ table: table.name, read, inserted, lastKey }, 'Progreso');
      nextProgressLog += PROGRESS_LOG_EVERY_ROWS;
    }

    if (rows.length < size) {
      return result(true);
    }
  }
}

export async function countFlowTable(
  mysql: Connection,
  postgres: pg.Client,
  table: FlowTable,
): Promise<FlowTableCounts> {
  const [source] = await mysql.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM ${quoteMysql(table.name)}`,
  );
  const target = await postgres.query<{ total: string }>(
    `SELECT count(*) AS total FROM ${targetTable(table)}`,
  );

  return {
    mysql: Number(source[0]?.['total'] ?? 0),
    postgres: Number(target.rows[0]?.total ?? 0),
  };
}
