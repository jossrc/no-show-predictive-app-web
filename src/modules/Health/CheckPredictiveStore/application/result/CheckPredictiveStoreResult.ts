export interface CheckPredictiveStoreResult {
  readonly service: 'predictive-store';
  readonly status: 'ok' | 'error' | 'disabled';
  readonly message: string;
  readonly driver: 'sqlite' | null;
  readonly schemaVersion: string | null;
  readonly dataSourceMode: 'READ_ONLY_EXISTING_SCHEDULE' | 'SYNTHETIC_DEMO_ONLY' | null;
  readonly durable: boolean;
  /** PostgreSQL es fuente de solo lectura: el almacén de la app nunca es la réplica. */
  readonly sourceDatabaseWritable: false;
}
