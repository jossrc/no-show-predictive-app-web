import type {
  AppStoreDatabase,
  AppStoreQueryable,
  SqlValue,
} from '../../../../../infrastructure/database/postgres/PredictiveAppDatabase.js';
import type { DataSourceMode } from '../../../../../shared/data/DataSourceMode.js';
import { verifySnapshotIntegrity } from '../../calculation/VerifySnapshotIntegrity.js';
import {
  mapResultRow,
  mapSnapshotRow,
  RESULT_COLUMNS,
  SNAPSHOT_COLUMNS,
  type PgRow,
} from './PostgresRows.js';

/**
 * Importación PUNTUAL (no runtime) del histórico del almacén SQLite de Sprint 01 a ml.app_*.
 * Recibe filas ya leídas (el adaptador CLI abre una COPIA del archivo en solo lectura): este
 * módulo no depende de SQLite. Idempotente por claves naturales, en UNA transacción, en orden FK
 * (snapshots → runs → resultados), conservando identidades públicas (run_uid), instantes y la
 * probabilidad exacta; luego reconcilia conteos e identidades. Nunca borra ni modifica el origen.
 */
export type LegacyStoreName = 'sqlite:read_only_existing_schedule' | 'sqlite:synthetic_demo_only';

export function legacyStoreNameFor(mode: DataSourceMode): LegacyStoreName {
  return mode === 'SYNTHETIC_DEMO_ONLY'
    ? 'sqlite:synthetic_demo_only'
    : 'sqlite:read_only_existing_schedule';
}

type LegacyValue = string | number | null;
export type LegacyRow = Readonly<Record<string, LegacyValue>>;

export interface LegacyPredictiveStoreDump {
  readonly dataSourceMode: DataSourceMode;
  readonly snapshots: readonly LegacyRow[];
  readonly runs: readonly LegacyRow[];
  readonly results: readonly LegacyRow[];
}

export interface LegacyImportCounts {
  readonly snapshots: number;
  readonly runs: number;
  readonly results: number;
}

export interface LegacyImportReport {
  readonly legacyStore: LegacyStoreName;
  readonly source: LegacyImportCounts;
  readonly inserted: LegacyImportCounts;
  readonly alreadyPresent: LegacyImportCounts;
  /** Filas del origen localizadas en PostgreSQL con contenido idéntico. */
  readonly reconciled: LegacyImportCounts;
  readonly mismatches: readonly string[];
}

export class LegacyImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyImportError';
  }
}

function str(row: LegacyRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new LegacyImportError(`Columna ${column} inválida`);
  return value;
}

function opt(row: LegacyRow, column: string): string | null {
  const value = row[column];
  return value === null || value === undefined ? null : str(row, column);
}

function num(row: LegacyRow, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new LegacyImportError(`Columna ${column} inválida`);
  }
  return value;
}

function optNum(row: LegacyRow, column: string): number | null {
  const value = row[column];
  return value === null || value === undefined ? null : num(row, column);
}

function id(row: LegacyRow, column: string): string {
  const value = row[column];
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string' && /^[1-9][0-9]{0,17}$/.test(value)) return value;
  throw new LegacyImportError(`Columna ${column} inválida`);
}

function instant(row: LegacyRow, column: string): Date {
  const value = new Date(str(row, column));
  if (Number.isNaN(value.getTime())) throw new LegacyImportError(`Columna ${column} inválida`);
  return value;
}

async function one<T extends object>(
  tx: AppStoreQueryable,
  sql: string,
  params: readonly SqlValue[],
): Promise<T | null> {
  return (await tx.query<T>(sql, params))[0] ?? null;
}

async function importSnapshots(
  tx: AppStoreQueryable,
  dump: LegacyPredictiveStoreDump,
  legacy: LegacyStoreName,
  ids: Map<string, string>,
): Promise<number> {
  let inserted = 0;
  for (const row of dump.snapshots) {
    const legacyId = id(row, 'snapshot_id');
    const reservationId = id(row, 'reservation_id');
    const hash = str(row, 'snapshot_hash');
    const created = await one<{ snapshot_id: string }>(
      tx,
      `INSERT INTO ml.app_booking_feature_snapshots (
         reservation_id, client_id, snapshot_type, prediction_at, appointment_at, feature_version,
         builder_version, snapshot_hash, features, evidence_source, evidence,
         source_ingestion_batch_id, created_at, legacy_store, legacy_id
       ) VALUES ($1::bigint, $2::bigint, 'booking_creation', $3, $4, $5, $6, $7, $8::jsonb, $9,
                 $10::jsonb, $11, $12, $13, $14::bigint)
       ON CONFLICT DO NOTHING
       RETURNING snapshot_id::text AS snapshot_id`,
      [
        reservationId,
        id(row, 'client_id'),
        instant(row, 'prediction_at'),
        instant(row, 'appointment_at'),
        str(row, 'feature_version'),
        str(row, 'builder_version'),
        hash,
        str(row, 'features_json'),
        str(row, 'evidence_source'),
        str(row, 'evidence_json'),
        opt(row, 'source_ingestion_batch_id'),
        instant(row, 'created_at'),
        legacy,
        legacyId,
      ],
    );
    const found =
      created ??
      (await one<{ snapshot_id: string }>(
        tx,
        `SELECT snapshot_id::text AS snapshot_id FROM ml.app_booking_feature_snapshots
         WHERE reservation_id = $1::bigint AND snapshot_hash = $2`,
        [reservationId, hash],
      ));
    if (!found) throw new LegacyImportError(`Snapshot legado ${legacyId} no localizable`);
    if (created) inserted += 1;
    ids.set(legacyId, found.snapshot_id);
  }
  return inserted;
}

async function importRuns(
  tx: AppStoreQueryable,
  dump: LegacyPredictiveStoreDump,
  legacy: LegacyStoreName,
  snapshotIds: ReadonlyMap<string, string>,
  ids: Map<string, string>,
): Promise<number> {
  let inserted = 0;
  for (const row of dump.runs) {
    const legacyId = id(row, 'run_id');
    const snapshotId = snapshotIds.get(id(row, 'snapshot_id'));
    if (!snapshotId) throw new LegacyImportError(`Run legado ${legacyId} sin snapshot`);
    const runUid = str(row, 'run_uid');
    const created = await one<{ run_id: string }>(
      tx,
      `INSERT INTO ml.app_prediction_runs (
         run_uid, snapshot_id, reservation_id, mode, requested_model_keys, scoring_api_version,
         request_id, run_requested_at, completed_at, ml_latency_ms, legacy_store, legacy_id
       ) VALUES ($1::uuid, $2::bigint, $3::bigint, $4, $5::text[], $6, $7, $8, $9, $10, $11,
                 $12::bigint)
       ON CONFLICT DO NOTHING
       RETURNING run_id::text AS run_id`,
      [
        runUid,
        snapshotId,
        id(row, 'reservation_id'),
        str(row, 'mode'),
        (JSON.parse(str(row, 'requested_model_keys_json')) as unknown[]).map(String),
        str(row, 'scoring_api_version'),
        str(row, 'request_id'),
        instant(row, 'run_requested_at'),
        instant(row, 'completed_at'),
        num(row, 'ml_latency_ms'),
        legacy,
        legacyId,
      ],
    );
    const found =
      created ??
      (await one<{ run_id: string }>(
        tx,
        `SELECT run_id::text AS run_id FROM ml.app_prediction_runs
         WHERE run_uid = $1::uuid AND snapshot_id = $2::bigint`,
        [runUid, snapshotId],
      ));
    if (!found) throw new LegacyImportError(`Run legado ${legacyId} en conflicto`);
    if (created) inserted += 1;
    ids.set(legacyId, found.run_id);
  }
  return inserted;
}

function resultParams(
  row: LegacyRow,
  runId: string,
  snapshotId: string,
  legacy: LegacyStoreName,
): SqlValue[] {
  const warnings = opt(row, 'experimental_warnings_json');
  return [
    runId,
    snapshotId,
    id(row, 'reservation_id'),
    str(row, 'model_key'),
    str(row, 'algorithm'),
    str(row, 'model_version'),
    str(row, 'model_hash'),
    opt(row, 'model_hash_sha256'),
    str(row, 'feature_version'),
    instant(row, 'prediction_at'),
    instant(row, 'scored_at'),
    num(row, 'probability_no_show'),
    str(row, 'prediction_target'),
    str(row, 'validation_status'),
    str(row, 'calibration_status'),
    opt(row, 'risk_level'),
    opt(row, 'risk_policy_version'),
    str(row, 'risk_policy_status'),
    str(row, 'scoring_api_version'),
    str(row, 'research_policy_key'),
    opt(row, 'experimental_level'),
    opt(row, 'experimental_label'),
    opt(row, 'experimental_status'),
    opt(row, 'experimental_policy_id'),
    opt(row, 'experimental_policy_version'),
    opt(row, 'experimental_policy_hash'),
    optNum(row, 'experimental_low_upper_threshold'),
    optNum(row, 'experimental_high_lower_threshold'),
    opt(row, 'experimental_boundary_rule'),
    opt(row, 'experimental_meaning'),
    opt(row, 'experimental_score_space'),
    warnings,
    row.experimental_operational_use_allowed === null ? null : false,
    legacy,
    id(row, 'result_id'),
  ];
}

async function importResults(
  tx: AppStoreQueryable,
  dump: LegacyPredictiveStoreDump,
  legacy: LegacyStoreName,
  snapshotIds: ReadonlyMap<string, string>,
  runIds: ReadonlyMap<string, string>,
): Promise<number> {
  let inserted = 0;
  for (const row of dump.results) {
    const legacyId = id(row, 'result_id');
    const runId = runIds.get(id(row, 'run_id'));
    const snapshotId = snapshotIds.get(id(row, 'snapshot_id'));
    if (!runId || !snapshotId) throw new LegacyImportError(`Resultado legado ${legacyId} huérfano`);
    if (num(row, 'operational_use_allowed') !== 0) {
      throw new LegacyImportError(`Resultado legado ${legacyId} con uso operativo`);
    }
    const created = await tx.query(
      `INSERT INTO ml.app_prediction_model_results (
         run_id, snapshot_id, reservation_id, model_key, algorithm, model_version, model_hash,
         model_hash_sha256, feature_version, prediction_at, scored_at, probability_no_show,
         prediction_target, validation_status, calibration_status, operational_use_allowed,
         risk_level, risk_policy_version, risk_policy_status, scoring_api_version,
         research_policy_key, experimental_level, experimental_label, experimental_status,
         experimental_policy_id, experimental_policy_version, experimental_policy_hash,
         experimental_low_upper_threshold, experimental_high_lower_threshold,
         experimental_boundary_rule, experimental_meaning, experimental_score_space,
         experimental_warnings, experimental_approved_by, experimental_operational_use_allowed,
         legacy_store, legacy_id
       ) VALUES ($1::bigint, $2::bigint, $3::bigint, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 $14, $15, false, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
                 $28, $29, $30, $31, $32::jsonb, NULL, $33, $34, $35::bigint)
       ON CONFLICT DO NOTHING
       RETURNING result_id`,
      resultParams(row, runId, snapshotId, legacy),
    );
    inserted += created.length;
  }
  return inserted;
}

/** Compara cada fila legada con su contraparte en PostgreSQL (identidad + contenido exacto). */
async function reconcile(
  db: AppStoreQueryable,
  dump: LegacyPredictiveStoreDump,
  snapshotIds: ReadonlyMap<string, string>,
): Promise<{ reconciled: LegacyImportCounts; mismatches: string[] }> {
  const mismatches: string[] = [];
  let snapshots = 0;
  for (const row of dump.snapshots) {
    const pgId = snapshotIds.get(id(row, 'snapshot_id'));
    const [stored] = await db.query<PgRow>(
      `SELECT ${SNAPSHOT_COLUMNS} FROM ml.app_booking_feature_snapshots WHERE snapshot_id = $1::bigint`,
      [pgId ?? '0'],
    );
    try {
      if (!stored) throw new Error('ausente');
      const snapshot = mapSnapshotRow(stored);
      verifySnapshotIntegrity(snapshot, id(row, 'reservation_id'));
      if (snapshot.snapshotHash !== str(row, 'snapshot_hash')) throw new Error('hash');
      snapshots += 1;
    } catch {
      mismatches.push(`snapshot legado ${id(row, 'snapshot_id')}`);
    }
  }

  const runRows = await db.query<{ run_uid: string }>(
    `SELECT run_uid::text AS run_uid FROM ml.app_prediction_runs WHERE run_uid = ANY($1::uuid[])`,
    [dump.runs.map((row) => str(row, 'run_uid'))],
  );
  const runUids = new Set(runRows.map((row) => row.run_uid));
  const runs = dump.runs.filter((row) => runUids.has(str(row, 'run_uid').toLowerCase())).length;
  if (runs !== dump.runs.length) mismatches.push(`runs: ${runs}/${dump.runs.length}`);

  let results = 0;
  for (const row of dump.results) {
    const [stored] = await db.query<PgRow>(
      `SELECT ${RESULT_COLUMNS} FROM ml.app_prediction_model_results r
       JOIN ml.app_prediction_runs pr ON pr.run_id = r.run_id
       WHERE r.snapshot_id = $1::bigint AND r.model_key = $2 AND r.model_version = $3
         AND r.research_policy_key = $4`,
      [
        snapshotIds.get(id(row, 'snapshot_id')) ?? '0',
        str(row, 'model_key'),
        str(row, 'model_version'),
        str(row, 'research_policy_key'),
      ],
    );
    const score = stored ? mapResultRow(stored) : null;
    const legacyRun = dump.runs.find((run) => id(run, 'run_id') === id(row, 'run_id'));
    const identical =
      score !== null &&
      score.probabilityNoShow === num(row, 'probability_no_show') &&
      score.scoredAt.getTime() === instant(row, 'scored_at').getTime() &&
      score.predictionRunId === (legacyRun ? str(legacyRun, 'run_uid').toLowerCase() : '') &&
      score.modelHash === str(row, 'model_hash') &&
      (score.experimentalRisk?.level ?? null) === opt(row, 'experimental_level') &&
      (score.experimentalRisk?.policyHash ?? null) === opt(row, 'experimental_policy_hash') &&
      (score.experimentalRisk?.lowUpperThreshold ?? null) ===
        optNum(row, 'experimental_low_upper_threshold') &&
      (score.experimentalRisk?.highLowerThreshold ?? null) ===
        optNum(row, 'experimental_high_lower_threshold') &&
      score.riskLevel === opt(row, 'risk_level') &&
      score.operationalUseAllowed === false;
    if (identical) results += 1;
    else mismatches.push(`resultado legado ${id(row, 'result_id')}`);
  }
  return { reconciled: { snapshots, runs, results }, mismatches };
}

export async function importLegacyPredictiveStore(
  db: AppStoreDatabase,
  dump: LegacyPredictiveStoreDump,
): Promise<LegacyImportReport> {
  const [identity] = await db.query<{ data_source_mode: string }>(
    'SELECT data_source_mode FROM ml.app_predictive_store_identity',
  );
  if (identity?.data_source_mode !== dump.dataSourceMode) {
    throw new LegacyImportError(
      `El origen es ${dump.dataSourceMode} y la base destino está ligada a ${identity?.data_source_mode ?? 'ningún modo'}`,
    );
  }
  const legacy = legacyStoreNameFor(dump.dataSourceMode);
  const snapshotIds = new Map<string, string>();
  const runIds = new Map<string, string>();

  const inserted = await db.transaction(async (tx) => {
    const snapshots = await importSnapshots(tx, dump, legacy, snapshotIds);
    const runs = await importRuns(tx, dump, legacy, snapshotIds, runIds);
    const results = await importResults(tx, dump, legacy, snapshotIds, runIds);
    return { snapshots, runs, results };
  });

  const source = {
    snapshots: dump.snapshots.length,
    runs: dump.runs.length,
    results: dump.results.length,
  };
  const { reconciled, mismatches } = await reconcile(db, dump, snapshotIds);
  return {
    legacyStore: legacy,
    source,
    inserted,
    alreadyPresent: {
      snapshots: source.snapshots - inserted.snapshots,
      runs: source.runs - inserted.runs,
      results: source.results - inserted.results,
    },
    reconciled,
    mismatches,
  };
}
