/**
 * Definición funcional inicial de «próximos tres días»: ventana MÓVIL de 72 horas desde el
 * instante de consulta (Clock inyectado), `(now, now + 72 h]`. No usa días de calendario de Lima;
 * un ajuste futuro (p. ej., días calendario) se hace solo aquí.
 */
export const RETENTION_WINDOW_HOURS = 72;

const MS_PER_HOUR = 3_600_000;

export interface RetentionWindow {
  readonly hours: number;
  /** Instante de consulta: la cita debe ser estrictamente posterior (futura). */
  readonly startExclusive: Date;
  /** Límite superior incluido de la ventana. */
  readonly endInclusive: Date;
  /** Equivalentes semiabiertos `[start, end)` para las fuentes (precisión de milisegundos). */
  readonly sourceStartInclusive: Date;
  readonly sourceEndExclusive: Date;
}

export function retentionWindow(now: Date): RetentionWindow {
  const end = new Date(now.getTime() + RETENTION_WINDOW_HOURS * MS_PER_HOUR);
  return {
    hours: RETENTION_WINDOW_HOURS,
    startExclusive: now,
    endInclusive: end,
    sourceStartInclusive: new Date(now.getTime() + 1),
    sourceEndExclusive: new Date(end.getTime() + 1),
  };
}

export function isWithinRetentionWindow(appointmentAt: Date, window: RetentionWindow): boolean {
  const at = appointmentAt.getTime();
  return at > window.startExclusive.getTime() && at <= window.endInclusive.getTime();
}
