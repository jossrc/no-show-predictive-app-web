export interface CheckPredictiveStoreResult {
  readonly service: 'predictive-store';
  readonly status: 'ok' | 'error' | 'disabled';
  readonly message: string;
  readonly driver: 'postgresql' | null;
  readonly schemaVersion: string | null;
  readonly dataSourceMode: 'READ_ONLY_EXISTING_SCHEDULE' | 'SYNTHETIC_DEMO_ONLY' | null;
  readonly durable: boolean;
  /** Rol runtime sin superusuario ni CREATE en ml (null si no se pudo comprobar). */
  readonly restrictedRole: boolean | null;
  /** Las tablas fuente (raw_flow/analytics) nunca se escriben: solo ml.app_* propias. */
  readonly sourceDatabaseWritable: false;
}
