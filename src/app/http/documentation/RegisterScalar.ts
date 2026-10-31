import scalar from '@scalar/fastify-api-reference';
import type { FastifyInstance } from 'fastify';

/** Scalar descubre swagger y lo consulta al servir la especificación, después de ready(). */
export function registerScalar(app: FastifyInstance): void {
  app.register(scalar, {
    routePrefix: '/docs',
    configuration: {
      pageTitle: 'DEPI Predictive API',
      theme: 'default',
      layout: 'modern',
      authentication: { preferredSecurityScheme: 'InternalApiKey' },
      persistAuth: false,
      withDefaultFonts: false,
      telemetry: false,
    },
  });
}
