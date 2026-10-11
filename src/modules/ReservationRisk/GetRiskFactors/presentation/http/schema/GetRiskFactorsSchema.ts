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
  },
  contribution: { type: 'number' },
  absoluteContribution: { type: 'number', minimum: 0 },
  sensitiveAttribute: { type: 'boolean' },
});

export const GetRiskFactorsSchema = {
  params: ReservationIdParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      modelKey: { type: 'string', enum: [...ML_MODEL_KEYS], default: DEFAULT_ML_MODEL_KEY },
      topK: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
    },
  },
  response: {
    200: strictObject({
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
          sameModelIdentity: { type: 'boolean' },
          probabilityNoShow: { type: ['number', 'null'] },
        }),
        explanation: strictObject({
          method: { type: 'string', enum: ['tree_shap'] },
          outputSpace: { type: 'string', enum: ['probability', 'log_odds'] },
          outputLink: { type: 'string', enum: ['identity', 'sigmoid'] },
          units: { type: 'string' },
          baseValue: { type: 'number' },
          modelOutputInExplanationSpace: { type: 'number' },
          reconstructedOutputInExplanationSpace: { type: 'number' },
          additivityError: { type: 'number', minimum: 0 },
          otherFeaturesContribution: { type: 'number' },
          topK: { type: 'integer' },
          totalFeatureCount: { type: 'integer' },
          factors: { type: 'array', items: factor },
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
    400: ErrorResponseSchema,
    401: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    422: ErrorResponseSchema,
    429: ErrorResponseSchema,
    502: ErrorResponseSchema,
    503: ErrorResponseSchema,
    504: ErrorResponseSchema,
  },
} as const satisfies FastifySchema;
