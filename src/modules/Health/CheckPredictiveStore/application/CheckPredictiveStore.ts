import type { CheckPredictiveStoreResult } from './result/CheckPredictiveStoreResult.js';

/** Diagnóstico estructural del almacén local; no expone rutas, tamaños ni contenido. */
export interface PredictiveStoreHealthProbe {
  health(): {
    readonly status: 'ok' | 'error';
    readonly driver: 'sqlite';
    readonly schemaVersion: string | null;
    readonly dataSourceMode: 'READ_ONLY_EXISTING_SCHEDULE' | 'SYNTHETIC_DEMO_ONLY';
    readonly durable: boolean;
  };
}

export class CheckPredictiveStore {
  constructor(private readonly probe: PredictiveStoreHealthProbe | null) {}

  execute(): CheckPredictiveStoreResult {
    if (!this.probe) {
      return {
        service: 'predictive-store',
        status: 'disabled',
        message: 'Almacén predictivo local no inicializado (rutas de negocio deshabilitadas)',
        driver: null,
        schemaVersion: null,
        dataSourceMode: null,
        durable: false,
        sourceDatabaseWritable: false,
      };
    }
    const health = this.probe.health();
    return {
      service: 'predictive-store',
      status: health.status,
      message:
        health.status === 'ok'
          ? 'Almacén predictivo local disponible (PostgreSQL permanece de solo lectura)'
          : 'Almacén predictivo local no disponible',
      driver: health.driver,
      schemaVersion: health.schemaVersion,
      dataSourceMode: health.dataSourceMode,
      durable: health.durable,
      sourceDatabaseWritable: false,
    };
  }
}
