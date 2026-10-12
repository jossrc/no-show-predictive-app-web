import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { Environment } from '../../config/environment/Environment.js';
import { createPredictiveConfig } from '../../config/PredictiveConfig.js';
import { SqlitePredictiveStore } from '../../modules/ReservationRisk/Shared/persistence/sqlite/SqlitePredictiveStore.js';

const HELP = `Uso: npm run store:status | npm run store:backup

  status   Estado del almacén predictivo LOCAL (SQLite) del modo activo: versión, integridad y
           conteos agregados. No muestra datos ni rutas de clientes.
  backup   Copia consistente (VACUUM INTO) en .local/predictive-store/backups/ con permisos 0600.

Solo actúa sobre el archivo local; PostgreSQL (fuente de solo lectura) nunca se toca.`;

function counts(file: string): Record<string, number> {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const count = (table: string) =>
      Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);
    return {
      snapshots: count('booking_feature_snapshots'),
      runs: count('prediction_runs'),
      results: count('prediction_model_results'),
      experimentalResults: Number(
        db
          .prepare(
            'SELECT count(*) AS n FROM prediction_model_results WHERE experimental_level IS NOT NULL',
          )
          .get()?.n,
      ),
    };
  } finally {
    db.close();
  }
}

function main(): void {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { help: { type: 'boolean', default: false } },
  });
  const command = positionals[0];
  if (values.help || (command !== 'status' && command !== 'backup')) {
    console.log(HELP);
    return;
  }

  const config = createPredictiveConfig(Environment);
  const file = config.store.sqlitePath;
  const store = SqlitePredictiveStore.open({ path: file, mode: config.dataSourceMode });
  try {
    const health = store.health();
    if (command === 'status') {
      console.log(JSON.stringify({ ...health, ...counts(file) }, null, 2));
      return;
    }
    const directory = path.join(path.dirname(file), 'backups');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const target = path.join(
      directory,
      `${config.dataSourceMode.toLowerCase()}-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
    );
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      db.prepare('VACUUM INTO ?').run(target);
    } finally {
      db.close();
    }
    chmodSync(target, 0o600);
    console.log(
      JSON.stringify({ backup: path.relative(process.cwd(), target), ...counts(target) }, null, 2),
    );
  } finally {
    store.close();
  }
}

main();
