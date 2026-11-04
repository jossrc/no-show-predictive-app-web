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
        version: '1.2.0-sprint02-operational-optimization',
        summary: 'Backend Fastify — Sprints 01 y 02 · Sistema predictivo de inasistencias',
        description:
          'API principal del sistema web predictivo de inasistencias: reservas (PostgreSQL de solo lectura), probabilidades experimentales de Random Forest y XGBoost (Python v1/v2), explicaciones SHAP e historial as-of. Dos clasificaciones distintas: (1) riskLevel OPERATIVO, siempre null mientras no exista una política aprobada (riskPolicyStatus=pending_validation; filtrar/ordenar por él ⇒ 409 RISK_POLICY_UNAVAILABLE); (2) experimentalRisk, banda relativa EXPERIMENTAL Bajo/Medio/Alto (exploratorio) publicada por la política research_risk_v1_1 de Python v2 para cada modelo por separado (RESEARCH_PROVISIONAL, approvedBy=null). Las bandas son terciles relativos del score crudo: no son probabilidad de inasistencia ni riesgo clínico, y operationalUseAllowed=false en todo momento. Sprint 02 (Optimización operativa): HU-06 marca horarios HIGH como «Habilitado para sobreasignación», HU-07 registra la asistencia real y la contrasta por modelo, HU-08 registra si el espacio gestionado se recuperó; ninguna acción crea/modifica citas en FLOWww. Persistencia 100 % PostgreSQL (ADR-008): las tablas fuente raw_flow/analytics se leen por una conexión de SOLO LECTURA y snapshots, scores y registros de gestión se insertan en tablas propias ml.app_* por una conexión separada con privilegios mínimos (SELECT/INSERT). Todos los ejemplos son sintéticos.',
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
        {
          name: 'Operational optimization',
          description:
            'Sprint 02 · Épica 3: habilitación para sobreasignación (HU-06), resultado real de la cita (HU-07) y espacios recuperados (HU-08). Registros propios e inmutables; no modifican la agenda de FLOWww.',
        },
      ],
      components: {
        securitySchemes: {
          InternalApiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'x-api-key',
            description:
              'Clave interna provisional (servicio a servicio) para los endpoints de negocio de Sprint 01 y 02. No es login de usuarios (HU-21/HU-22 pendientes); nunca exponerla en el navegador.',
          },
        },
      },
    },
  });
}
