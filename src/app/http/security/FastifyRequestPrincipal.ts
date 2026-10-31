import type { RequestPrincipal } from '../../../shared/security/RequestPrincipal.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Asignado por la compuerta provisional de Sprint 01; null fuera de rutas protegidas. */
    principal: RequestPrincipal | null;
  }
}
