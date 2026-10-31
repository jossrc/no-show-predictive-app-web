/**
 * - booking_creation: mismo corte que la predicción (DiaryGCreated). Muestra la evidencia que
 *   pudo influir en el score. Es el modo por defecto.
 * - current_known: todo lo conocido hasta el momento de la consulta. Informativo; NUNCA
 *   retroalimenta el score original.
 */
export const HISTORICAL_AS_OF_MODES = ['booking_creation', 'current_known'] as const;

export type HistoricalAsOf = (typeof HISTORICAL_AS_OF_MODES)[number];
