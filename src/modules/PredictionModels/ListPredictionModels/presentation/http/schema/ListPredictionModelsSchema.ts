import type { FastifySchema } from 'fastify';
import { ErrorResponseSchema } from '../../../../../../app/http/errors/ErrorResponseSchema.js';

const model = {
  type: 'object',
  additionalProperties: false,
  required: [
    'modelKey',
    'algorithm',
    'modelVersion',
    'modelHash',
    'role',
    'featureCount',
    'validationStatus',
    'calibrationStatus',
    'operationalUseAllowed',
  ],
  properties: {
    modelKey: { type: 'string' },
    algorithm: { type: 'string', enum: ['random_forest', 'xgboost'] },
    modelVersion: { type: 'string' },
    modelHash: { type: 'string' },
    role: { type: 'string' },
    featureCount: { type: 'integer' },
    validationStatus: { type: 'string' },
    calibrationStatus: { type: 'string' },
    operationalUseAllowed: { type: 'boolean', enum: [false] },
  },
} as const;

export const ListPredictionModelsSchema = {
  tags: ['Prediction Models'],
  summary: 'Consultar catálogo de modelos',
  description:
    'Expone la identidad pública de Random Forest y XGBoost como modelos independientes. No existe ensemble ni ganador automático. validationStatus=EXPLORATORY_NOT_VALIDATED, calibrationStatus=not_operationally_validated y operationalUseAllowed=false. La política de riesgo OPERATIVA está pendiente de validación científica (riskPolicyStatus); experimentalRiskPolicy resume la política research v2 (bandas exploratorias por modelo), cuyo detalle está en GET /api/v1/ml/research-risk-policy.',
  security: [{ InternalApiKey: [] }],
  response: {
    200: {
      description: 'Identidad pública y estado experimental de los modelos independientes.',
      type: 'object',
      additionalProperties: false,
      required: ['data', 'requestId'],
      properties: {
        data: {
          type: 'object',
          additionalProperties: false,
          required: [
            'featureVersion',
            'defaultModelKey',
            'models',
            'riskPolicyStatus',
            'experimentalRiskPolicy',
          ],
          properties: {
            featureVersion: { type: 'string' },
            defaultModelKey: { type: 'string' },
            models: { type: 'array', items: model },
            riskPolicyStatus: { type: 'string', enum: ['pending_validation', 'approved'] },
            experimentalRiskPolicy: {
              type: 'object',
              additionalProperties: false,
              required: [
                'status',
                'available',
                'reason',
                'classificationBasis',
                'operationalUseAllowed',
                'policies',
              ],
              properties: {
                status: { type: 'string', enum: ['RESEARCH_PROVISIONAL', 'UNAVAILABLE'] },
                available: { type: 'boolean' },
                reason: { type: ['string', 'null'] },
                classificationBasis: {
                  type: ['string', 'null'],
                  enum: ['RESEARCH_PROVISIONAL', null],
                },
                operationalUseAllowed: { type: 'boolean', enum: [false] },
                policies: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['modelKey', 'policyId', 'policyVersion', 'policyHash'],
                    properties: {
                      modelKey: { type: 'string' },
                      policyId: { type: 'string' },
                      policyVersion: { type: 'string' },
                      policyHash: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        requestId: { type: 'string' },
      },
    },
    401: {
      ...ErrorResponseSchema,
      description:
        'Credencial x-api-key ausente o inválida; se comprueba antes de validar la solicitud.',
    },
    429: {
      ...ErrorResponseSchema,
      description: 'ML_RATE_LIMITED: límite de concurrencia o cola de solicitudes ML alcanzado.',
    },
    502: {
      ...ErrorResponseSchema,
      description: 'ML_CONTRACT_VIOLATION: respuesta inválida del servicio ML.',
    },
    503: {
      ...ErrorResponseSchema,
      description: 'ML_UNAVAILABLE o ML_CREDENTIAL_REJECTED: catálogo ML no disponible.',
    },
    504: {
      ...ErrorResponseSchema,
      description: 'ML_TIMEOUT: tiempo de espera del servicio ML agotado.',
    },
  },
} as const satisfies FastifySchema;
