import type { CheckPredictiveStoreResult } from './result/CheckPredictiveStoreResult.js';

/** Diagnóstico estructural del almacén de la app; no expone credenciales, host ni contenido. */
export interface PredictiveStoreHealthProbe {
  health(): Promise<{
    readonly status: 'ok' | 'error';
    readonly driver: 'postgresql';
    readonly schemaVersion: string | null;
    readonly dataSourceMode: 'READ_ONLY_EXISTING_SCHEDULE' | 'SYNTHETIC_DEMO_ONLY';
    readonly durable: boolean;
    readonly restrictedRole: boolean | null;
  }>;
}

export class CheckPredictiveStore {
  constructor(private readonly probe: PredictiveStoreHealthProbe | null) {}

  async execute(): Promise<CheckPredictiveStoreResult> {
    if (!this.probe) {
      return {
        service: 'predictive-store',
        status: 'disabled',
        message: 'Almacén predictivo no inicializado (rutas de negocio deshabilitadas)',
        driver: null,
        schemaVersion: null,
        dataSourceMode: null,
        durable: false,
        restrictedRole: null,
        sourceDatabaseWritable: false,
      };
    }
    const health = await this.probe.health();
    return {
      service: 'predictive-store',
      status: health.status,
      message:
        health.status === 'ok'
          ? 'Almacén predictivo PostgreSQL disponible (raw_flow/analytics permanecen de solo lectura)'
          : 'Almacén predictivo PostgreSQL no disponible',
      driver: health.driver,
      schemaVersion: health.schemaVersion,
      dataSourceMode: health.dataSourceMode,
      durable: health.durable,
      restrictedRole: health.restrictedRole,
      sourceDatabaseWritable: false,
    };
  }
}
