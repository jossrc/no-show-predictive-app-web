export interface CheckMlServiceResult {
  readonly service: 'ml';
  readonly status: 'ok' | 'error' | 'disabled';
  readonly message: string;
  /** Estado de servicio declarado por Python (siempre exploratorio en Sprint 01). */
  readonly servingStatus: 'EXPLORATORY_NOT_VALIDATED' | null;
  readonly operationalUseAllowed: false;
}
