/**
 * Estado de GESTIÓN de retención por reserva, independiente del estado de la reserva, de la
 * asistencia, de la habilitación preventiva, de la recuperación de espacios y de la predicción.
 * PENDING se deriva de la AUSENCIA de un registro de contacto (no se insertan filas artificiales).
 */
export const RETENTION_STATUSES = ['PENDING', 'CAMPAIGN_SENT'] as const;
export type RetentionStatus = (typeof RETENTION_STATUSES)[number];

export const RETENTION_STATUS_LABELS: Readonly<Record<RetentionStatus, string>> = {
  PENDING: 'Gestión pendiente',
  CAMPAIGN_SENT: 'Campaña de retención enviada',
};
