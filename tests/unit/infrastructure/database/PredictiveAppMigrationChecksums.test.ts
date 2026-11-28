import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadPredictiveAppMigrations } from '../../../../src/infrastructure/database/postgres/PredictiveAppMigrationRunner.js';

const MIGRATIONS_DIR = path.resolve(
  import.meta.dirname,
  '../../../../migrations/postgres/predictive_app',
);

/**
 * Checksums SHA-256 de migraciones YA APLICADAS en la base real (`ml.app_predictive_store_migrations`).
 * Son inmutables (ADR-008): cualquier byte cambiado, incluso un comentario, hace que
 * `store:migrate` aborte con "Checksum distinto". Al aplicar una migración nueva en la base real,
 * añadir aquí su checksum; nunca editar uno existente. Ver docs/reservation-import-and-retention/incidente-checksum-001.md.
 */
const APPLIED_CHECKSUMS: Readonly<Record<string, string>> = {
  '001': '09b844b486fde171da5c07b3f158504812af57ce064937a5cbc30e32d1d18840',
  '002': 'ad2b5cba9be073f4ad5da308d20b90088f92192599604a59918dfb4685173c65',
  '003': 'beb1951e2ff6b1e53e3f9e32ee8b44cd069d9f5f376a2c706bcba9329671acff',
};

describe('Migraciones aplicadas del almacén predictivo (checksum inmutable)', () => {
  it('los archivos conservan byte a byte el checksum registrado en la base real', async () => {
    const migrations = await loadPredictiveAppMigrations(MIGRATIONS_DIR);
    for (const [version, checksum] of Object.entries(APPLIED_CHECKSUMS)) {
      const migration = migrations.find((candidate) => candidate.version === version);
      assert.ok(migration, `falta el archivo de la migración aplicada ${version}`);
      assert.equal(
        migration.checksum,
        checksum,
        `la migración aplicada ${version} fue modificada; restaure el archivo original`,
      );
    }
  });
});
