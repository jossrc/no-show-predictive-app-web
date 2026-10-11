import type { FastifySchema } from 'fastify';
import { ErrorResponseSchema } from '../../../../../../app/http/errors/ErrorResponseSchema.js';
import {
  DEFAULT_ML_MODEL_KEY,
  ML_MODEL_KEYS,
} from '../../../../../../infrastructure/http/ml/MlFeatureContract.js';
import { ReservationIdParamsSchema } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';

const strictObject = (properties: Record<string, unknown>) =>
  ({
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  }) as const;

const factor = strictObject({
  featureName: { type: 'string' },
  label: { type: 'string' },
  direction: {
    type: 'string',
    enum: ['increases_model_output', 'decreases_model_output', 'neutral'],
    description: 'Dirección de la asociación con la salida del modelo, sin interpretación causal.',
  },
  contribution: {
    type: 'number',
    description:
      'Contribución SHAP con signo en outputSpace: probabilidad para Random Forest o log-odds para XGBoost.',
  },
  absoluteContribution: {
    type: 'number',
    minimum: 0,
    description: 'Magnitud absoluta de contribution, en el mismo espacio de salida.',
  },
  sensitiveAttribute: { type: 'boolean' },
});

export const GetRiskFactorsSchema = {
  tags: ['Explanations'],
  summary: 'Consultar factores explicativos SHAP',
  description:
    'Factores asociados localmente a la salida del modelo; no representan causalidad. Utiliza el snapshot original y no modifica el score persistido. Random Forest: outputSpace=probability, outputLink=identity y contribuciones en escala de probabilidad. XGBoost: outputSpace=log_odds, outputLink=sigmoid y contribuciones en log-odds, no puntos porcentuales. Sin snapshot válido devuelve 409 EXPLANATION_SNAPSHOT_UNAVAILABLE. Las estimaciones siguen siendo exploratorias y sin nivel de riesgo aprobado.',
  security: [{ InternalApiKey: [] }],
  params: ReservationIdParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      modelKey: {
        type: 'string',
        enum: [...ML_MODEL_KEYS],
        default: DEFAULT_ML_MODEL_KEY,
        description: 'Modelo independiente cuya salida se explica mediante Tree SHAP.',
      },
      topK: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        default: 5,
        description: 'Número máximo de factores locales mostrados. Ejemplo sintético.',
        examples: [5],
      },
    },
  },
  response: {
    200: {
      description:
        'Explicación Tree SHAP local en el espacio de salida del modelo; sin interpretación causal.',
      ...strictObject({
        data: strictObject({
          reservationId: { type: 'string' },
          snapshot: strictObject({
            predictionAt: { type: 'string', format: 'date-time' },
            featureVersion: { type: 'string' },
            builderVersion: { type: 'string' },
            snapshotHash: { type: 'string' },
          }),
          model: strictObject({
            modelKey: { type: 'string' },
            algorithm: { type: 'string', enum: ['random_forest', 'xgboost'] },
            modelVersion: { type: 'string' },
            modelHash: { type: 'string' },
            validationStatus: { type: 'string' },
            calibrationStatus: { type: 'string' },
            operationalUseAllowed: { type: 'boolean', enum: [false] },
          }),
          probabilityNoShow: { type: 'number', minimum: 0, maximum: 1 },
          percentageNoShow: { type: 'number', minimum: 0, maximum: 100 },
          persistedScore: strictObject({
            available: { type: 'boolean' },
            sameModelIdentity: {
              type: 'boolean',
              description:
                'Indica si el score guardado tiene la misma versión y hash que el modelo explicado.',
            },
            probabilityNoShow: { type: ['number', 'null'] },
          }),
          explanation: strictObject({
            method: { type: 'string', enum: ['tree_shap'] },
            outputSpace: {
              type: 'string',
              enum: ['probability', 'log_odds'],
              description:
                'Random Forest usa probability; XGBoost usa log_odds, sin representar puntos porcentuales.',
            },
            outputLink: {
              type: 'string',
              enum: ['identity', 'sigmoid'],
              description: 'identity para probability; sigmoid convierte log_odds en probabilidad.',
            },
            units: { type: 'string' },
            baseValue: {
              type: 'number',
              description: 'Valor base de la explicación en el espacio de salida indicado.',
            },
            modelOutputInExplanationSpace: { type: 'number' },
            reconstructedOutputInExplanationSpace: { type: 'number' },
            additivityError: {
              type: 'number',
              minimum: 0,
              description: 'Error absoluto de reconstrucción aditiva en outputSpace.',
            },
            otherFeaturesContribution: { type: 'number' },
            topK: { type: 'integer' },
            totalFeatureCount: { type: 'integer' },
            factors: {
              type: 'array',
              items: factor,
              description:
                'Factores asociados localmente a la salida del modelo; no explican causas de inasistencia.',
            },
          }),
          interpretation: strictObject({
            scope: { type: 'string', enum: ['local_association_not_causality'] },
            note: { type: 'string' },
            unitsNote: { type: 'string' },
            sensitiveAttributesNote: { type: 'string' },
          }),
          riskLevel: { type: 'null' },
          riskPolicyStatus: { type: 'string', enum: ['pending_validation', 'approved'] },
        }),
        requestId: { type: 'string' },
      }),
    },
    400: {
      ...ErrorResponseSchema,
      description: 'Solicitud inválida: REQUEST_VALIDATION_ERROR en parámetros, query o cuerpo.',
    },
    401: {
      ...ErrorResponseSchema,
      description:
        'Credencial x-api-key ausente o inválida; se comprueba antes de validar la solicitud.',
    },
    404: {
      ...ErrorResponseSchema,
      description: 'RESERVATION_NOT_FOUND: reserva inexistente o inaccesible para el consumidor.',
    },
    409: {
      ...ErrorResponseSchema,
      description:
        'EXPLANATION_SNAPSHOT_UNAVAILABLE: no existe un snapshot temporalmente válido para explicar.',
    },
    422: {
      ...ErrorResponseSchema,
      description: 'Solicitud de explicación semánticamente inválida.',
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
      description:
        'EXPLANATION_UNAVAILABLE, ML_UNAVAILABLE o ML_CREDENTIAL_REJECTED: explicación o dependencia ML no disponible.',
    },
    504: {
      ...ErrorResponseSchema,
      description: 'ML_TIMEOUT: tiempo de espera del servicio ML agotado.',
    },
  },
} as const satisfies FastifySchema;
