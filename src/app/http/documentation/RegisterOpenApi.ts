import swagger from '@fastify/swagger';
import type { FastifyInstance } from 'fastify';

/** Encolar en la raíz antes de RegisterModules: onRoute alcanza los módulos encapsulados. */
export function registerOpenApi(app: FastifyInstance): void {
  app.register(swagger, {
    mode: 'dynamic',
    convertConstToEnum: false,
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'DEPI — No-Show Predictive API',
        version: '1.0.0-sprint01',
        summary: 'Backend Fastify — Sprint 01 · Sistema predictivo de inasistencias',
        description:
          'API principal del sistema web predictivo de inasistencias. Sprint 01: consulta de reservas, probabilidades experimentales de Random Forest y XGBoost, explicaciones SHAP e historial de inasistencias. Las estimaciones no están científicamente validadas para uso operativo.',
      },
      servers: [{ url: 'http://127.0.0.1:3000', description: 'Servidor de desarrollo' }],
      tags: [
        { name: 'Health', description: 'Comprobaciones públicas de disponibilidad.' },
        { name: 'Reservations', description: 'Listado paginado y detalle factual de reservas.' },
        {
          name: 'Reservation Risk',
          description: 'Consulta de estimaciones exploratorias guardadas.',
        },
        { name: 'Predictions', description: 'Solicitud explícita e idempotente de inferencia.' },
        {
          name: 'Explanations',
          description: 'Factores SHAP asociados localmente a la salida del modelo.',
        },
        {
          name: 'Client History',
          description: 'Historial temporal con etiqueta proxy NO_SHOW_CANDIDATE.',
        },
        {
          name: 'Prediction Models',
          description: 'Catálogo de Random Forest y XGBoost independientes.',
        },
      ],
      components: {
        securitySchemes: {
          InternalApiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'x-api-key',
            description: 'Clave interna provisional para consumir los endpoints del Sprint 01.',
          },
        },
      },
    },
  });
}
