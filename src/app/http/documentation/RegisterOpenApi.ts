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
        version: '1.1.0-research-risk-v2',
        summary: 'Backend Fastify — Sprint 01 · Sistema predictivo de inasistencias',
        description:
          'API principal del sistema web predictivo de inasistencias: reservas (PostgreSQL de solo lectura), probabilidades experimentales de Random Forest y XGBoost (Python v1/v2), explicaciones SHAP e historial as-of. Dos clasificaciones distintas: (1) riskLevel OPERATIVO, siempre null mientras no exista una política aprobada (riskPolicyStatus=pending_validation; filtrar/ordenar por él ⇒ 409 RISK_POLICY_UNAVAILABLE); (2) experimentalRisk, banda relativa EXPERIMENTAL Bajo/Medio/Alto (exploratorio) publicada por la política research_risk_v1_1 de Python v2 para cada modelo por separado (RESEARCH_PROVISIONAL, approvedBy=null). Las bandas son terciles relativos del score crudo: no son probabilidad de inasistencia ni riesgo clínico, y operationalUseAllowed=false en todo momento. Snapshots y scores se persisten en un almacén SQLite local; la base PostgreSQL nunca se escribe. Todos los ejemplos son sintéticos.',
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
          description:
            'Catálogo de Random Forest y XGBoost independientes y política experimental de bandas (research v2).',
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
