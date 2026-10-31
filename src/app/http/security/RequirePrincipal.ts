import type { FastifyRequest } from 'fastify';
import { UnauthorizedException } from '../../../shared/errors/security/UnauthorizedException.js';
import type { RequestPrincipal } from '../../../shared/security/RequestPrincipal.js';
import './FastifyRequestPrincipal.js';

/** Falla cerrado: una ruta de negocio sin principal asignado nunca concede acceso. */
export function requirePrincipal(request: FastifyRequest): RequestPrincipal {
  if (!request.principal) {
    throw new UnauthorizedException({ message: 'Credencial interna ausente o inválida' });
  }
  return request.principal;
}
