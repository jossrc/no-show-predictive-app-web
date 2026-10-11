import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** Mismo formato aceptado por el servicio ML: 1-64 caracteres, inicial alfanumérica. */
const OPAQUE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const REQUEST_ID_HEADER = 'x-request-id';

export function isOpaqueRequestId(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_REQUEST_ID.test(value);
}

/** Reutiliza un X-Request-ID externo solo si es opaco y válido; si no, genera un UUID. */
export function resolveRequestId(request: IncomingMessage): string {
  const header = request.headers[REQUEST_ID_HEADER];
  return isOpaqueRequestId(header) ? header : randomUUID();
}
