/**
 * Identificadores BIGINT de PostgreSQL transportados como cadena decimal para no perder
 * precisión por encima de Number.MAX_SAFE_INTEGER. Máximo 18 dígitos: siempre < int8 máximo.
 */
export const DECIMAL_ID_PATTERN = '^[1-9][0-9]{0,17}$';

const DECIMAL_ID = new RegExp(DECIMAL_ID_PATTERN);

export type DecimalId = string;

export function isDecimalId(value: unknown): value is DecimalId {
  return typeof value === 'string' && DECIMAL_ID.test(value);
}
