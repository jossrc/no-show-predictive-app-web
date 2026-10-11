import { createHash, timingSafeEqual } from 'node:crypto';

export const MIN_INTERNAL_API_KEY_LENGTH = 32;
export const MAX_INTERNAL_API_KEY_LENGTH = 512;

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Compara en tiempo constante el SHA-256 de la credencial recibida con el hash configurado.
 * La credencial en claro no se almacena en configuración ni se registra en logs.
 */
export function isValidInternalApiKey(
  provided: string | undefined,
  expectedSha256Hex: string,
): boolean {
  if (
    typeof provided !== 'string' ||
    provided.length < MIN_INTERNAL_API_KEY_LENGTH ||
    provided.length > MAX_INTERNAL_API_KEY_LENGTH
  ) {
    return false;
  }

  const expected = Buffer.from(expectedSha256Hex, 'hex');
  const actual = createHash('sha256').update(provided, 'utf8').digest();

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
