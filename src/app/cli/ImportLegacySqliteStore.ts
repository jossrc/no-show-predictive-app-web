import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { Environment } from '../../config/environment/Environment.js';
import { resolveAppDatabaseConfig } from '../../config/PredictiveConfig.js';
import { DATA_SOURCE_MODES, type DataSourceMode } from '../../shared/data/DataSourceMode.js';
import {
  importLegacyPredictiveStore,
  type LegacyPredictiveStoreDump,
  type LegacyRow,
} from '../../modules/ReservationRisk/Shared/persistence/postgres/LegacyPredictiveStoreImporter.js';
import { PostgresPredictiveStore } from '../../modules/ReservationRisk/Shared/persistence/postgres/PostgresPredictiveStore.js';
import { cliErrorMessage } from './PredictiveStoreCliConnection.js';

/**
 * UTILIDAD EXCEPCIONAL DE TRANSFERENCIA (ADR-008), no forma parte del runtime ni de las pruebas:
 * es el ÚNICO punto del repositorio que lee SQLite, y solo para migrar el histórico de Sprint 01.
 * Copia el archivo (+ -wal/-shm) a un directorio temporal privado y abre LA COPIA en solo
 * lectura: el archivo original jamás se abre, modifica ni borra.
 */
const HELP = `Uso: npm run store:import-legacy -- --sqlite <ruta.sqlite> [--dry-run]

  --sqlite    Archivo del almacén SQLite de Sprint 01 (p. ej. un respaldo en
              .local/predictive-store/backups/...). Se lee una COPIA temporal.
  --dry-run   Solo inventario (conteos, modo, checksums); no escribe en PostgreSQL.

Escribir exige PREDICTIVE_STORE_IMPORT_AUTHORIZED=true, la base APP_DB_* ya migrada y ligada al
mismo DATA_SOURCE_MODE que el archivo. Idempotente: re-ejecutar no duplica filas.`;

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function readDump(original: string): {
  dump: LegacyPredictiveStoreDump;
  checksums: Record<string, string>;
} {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'nsp-legacy-import-'));
  const checksums: Record<string, string> = {};
  try {
    const copy = path.join(directory, 'legacy.sqlite');
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(`${original}${suffix}`)) {
        copyFileSync(`${original}${suffix}`, `${copy}${suffix}`);
        checksums[`${path.basename(original)}${suffix}`] = sha256(`${original}${suffix}`);
      }
    }
    const db = new DatabaseSync(copy, { readOnly: true });
    try {
      const rows = (sql: string): LegacyRow[] => db.prepare(sql).all() as unknown as LegacyRow[];
      const meta = rows(`SELECT value FROM store_meta WHERE key = 'data_source_mode'`)[0];
      const mode = meta?.value;
      if (!DATA_SOURCE_MODES.includes(mode as DataSourceMode)) {
        throw new Error('El archivo no declara un DATA_SOURCE_MODE válido en store_meta');
      }
      return {
        checksums,
        dump: {
          dataSourceMode: mode as DataSourceMode,
          snapshots: rows('SELECT * FROM booking_feature_snapshots ORDER BY snapshot_id'),
          runs: rows('SELECT * FROM prediction_runs ORDER BY run_id'),
          results: rows('SELECT * FROM prediction_model_results ORDER BY result_id'),
        },
      };
    } finally {
      db.close();
    }
  } finally {
    // Solo se elimina la COPIA temporal creada por esta utilidad.
    rmSync(directory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      sqlite: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || !values.sqlite) {
    console.log(HELP);
    return;
  }
  const original = path.resolve(values.sqlite);
  if (!existsSync(original)) throw new Error('Archivo SQLite no encontrado');

  const { dump, checksums } = readDump(original);
  const inventory = {
    dataSourceMode: dump.dataSourceMode,
    snapshots: dump.snapshots.length,
    runs: dump.runs.length,
    results: dump.results.length,
    checksums,
  };
  const dryRun = values['dry-run'] === true;
  console.log(JSON.stringify({ inventory, dryRun }, null, 2));
  if (dryRun) return;

  if (process.env.PREDICTIVE_STORE_IMPORT_AUTHORIZED !== 'true') {
    console.error(
      'store:import-legacy bloqueado: PREDICTIVE_STORE_IMPORT_AUTHORIZED=true requerido',
    );
    process.exitCode = 2;
    return;
  }
  const database = resolveAppDatabaseConfig(Environment);
  if (Environment.DATA_SOURCE_MODE !== dump.dataSourceMode) {
    throw new Error('DATA_SOURCE_MODE del entorno distinto del modo del archivo');
  }
  const store = await PostgresPredictiveStore.open(database, {
    mode: Environment.DATA_SOURCE_MODE,
    allowPrivilegedRole: Environment.APP_DB_ALLOW_PRIVILEGED_ROLE,
  });
  try {
    const report = await importLegacyPredictiveStore(store.database, dump);
    // El original sigue intacto: mismo checksum que antes de la importación.
    const unchanged = Object.entries(checksums).every(([name, checksum]) => {
      const file = path.join(path.dirname(original), name);
      return existsSync(file) && sha256(file) === checksum;
    });
    console.log(JSON.stringify({ report, sourceFilesUnchanged: unchanged }, null, 2));
    if (report.mismatches.length > 0 || !unchanged) process.exitCode = 3;
  } finally {
    await store.close();
  }
}

main().catch((error: unknown) => {
  console.error('Error en store:import-legacy:', cliErrorMessage(error));
  process.exitCode = 1;
});
