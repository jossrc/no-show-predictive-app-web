import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

const PROBE_SQL = `
SELECT to_regclass('ml.booking_feature_snapshots') IS NOT NULL
   AND to_regclass('ml.prediction_runs') IS NOT NULL
   AND to_regclass('ml.prediction_model_results') IS NOT NULL AS ready`;

/**
 * Detecta si las migraciones del almacén predictivo (schema ml) están aplicadas. Permite que el
 * listado de reservas funcione sin scores cuando aún no se ejecutó `npm run migrate:app`.
 */
export class PredictiveStoreProbe {
  private cached: { ready: boolean; checkedAtMs: number } | null = null;

  constructor(
    private readonly sequelize: Sequelize,
    private readonly ttlMs = 30_000,
    private readonly nowMs: () => number = Date.now,
  ) {}

  async isReady(): Promise<boolean> {
    if (this.cached && this.nowMs() - this.cached.checkedAtMs < this.ttlMs) {
      return this.cached.ready;
    }

    const rows = await this.sequelize.query<{ ready: boolean }>(PROBE_SQL, {
      type: QueryTypes.SELECT,
    });
    const ready = rows[0]?.ready === true;
    this.cached = { ready, checkedAtMs: this.nowMs() };
    return ready;
  }
}

/** Código SQLSTATE 42P01 (undefined_table): esquema predictivo sin migrar. */
export function isUndefinedTableError(error: unknown): boolean {
  const original = (error as { original?: { code?: unknown } } | null)?.original;
  const parent = (error as { parent?: { code?: unknown } } | null)?.parent;
  return original?.code === '42P01' || parent?.code === '42P01';
}
