import type { FastifyInstance, FastifyRequest } from 'fastify';
import { UnauthorizedException } from '../../../shared/errors/security/UnauthorizedException.js';
import { PROVISIONAL_INTERNAL_PRINCIPAL } from '../../../shared/security/RequestPrincipal.js';
import { isValidInternalApiKey } from '../../../shared/security/VerifyInternalApiKey.js';
import './FastifyRequestPrincipal.js';

const API_KEY_HEADER = 'x-api-key';

function readSingleHeader(request: FastifyRequest): string | undefined {
  const header = request.headers[API_KEY_HEADER];
  // Cabeceras duplicadas se rechazan: no se elige arbitrariamente un valor.
  return typeof header === 'string' ? header : undefined;
}

/**
 * Compuerta provisional de Sprint 01 (no es login HU-21 ni RBAC HU-22).
 * Se ejecuta en onRequest: responde 401 antes de parsear cuerpo o validar parámetros,
 * por lo que no revela si una reserva existe.
 */
export function registerInternalApiKeyGuard(app: FastifyInstance, expectedSha256Hex: string): void {
  app.decorateRequest('principal', null);

  app.addHook('onRequest', async (request) => {
    if (!isValidInternalApiKey(readSingleHeader(request), expectedSha256Hex)) {
      throw new UnauthorizedException({ message: 'Credencial interna ausente o inválida' });
    }

    request.principal = PROVISIONAL_INTERNAL_PRINCIPAL;
  });
}
