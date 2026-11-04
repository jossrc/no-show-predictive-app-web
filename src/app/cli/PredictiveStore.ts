import { parseArgs } from 'node:util';
import { Environment } from '../../config/environment/Environment.js';
import { resolveAppDatabaseConfig } from '../../config/PredictiveConfig.js';
import { PostgresPredictiveStore } from '../../modules/ReservationRisk/Shared/persistence/postgres/PostgresPredictiveStore.js';
import { cliErrorMessage } from './PredictiveStoreCliConnection.js';

const HELP = `Uso: npm run store:status

  Estado del almacén predictivo PostgreSQL de la app (ml.app_*): driver, versión de esquema,
  modo ligado, rol restringido y conteos agregados por tabla. Solo lectura; no muestra datos,
  credenciales ni host. Los respaldos se realizan con pg_dump (procedimiento manual del
  operador, ver docs/sprint-02/postgresql-only-migration.md); no hay restore automático.`;

const COUNTED_TABLES = [
  'ml.app_booking_feature_snapshots',
  'ml.app_prediction_runs',
  'ml.app_prediction_model_results',
  'ml.app_overbooking_authorizations',
  'ml.app_attendance_outcomes',
  'ml.app_attendance_prediction_comparisons',
  'ml.app_space_recovery_outcomes',
] as const;

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { help: { type: 'boolean', default: false } } });
  if (values.help) {
    console.log(HELP);
    return;
  }

  const database = resolveAppDatabaseConfig(Environment);
  const store = await PostgresPredictiveStore.open(database, {
    mode: Environment.DATA_SOURCE_MODE,
    allowPrivilegedRole: Environment.APP_DB_ALLOW_PRIVILEGED_ROLE,
  });
  try {
    const counts: Record<string, number> = {};
    for (const table of COUNTED_TABLES) {
      const [row] = await store.database.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM ${table}`,
      );
      counts[table] = Number(row?.total ?? 0);
    }
    const [legacy] = await store.database.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM ml.app_prediction_model_results WHERE legacy_store IS NOT NULL`,
    );
    console.log(
      JSON.stringify(
        { ...(await store.health()), counts, importedLegacyResults: Number(legacy?.total ?? 0) },
        null,
        2,
      ),
    );
  } finally {
    await store.close();
  }
}

main().catch((error: unknown) => {
  console.error('Error en store:status:', cliErrorMessage(error));
  process.exitCode = 1;
});
