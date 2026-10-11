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
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['data', 'requestId'],
      properties: {
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['featureVersion', 'defaultModelKey', 'models', 'riskPolicyStatus'],
          properties: {
            featureVersion: { type: 'string' },
            defaultModelKey: { type: 'string' },
            models: { type: 'array', items: model },
            riskPolicyStatus: { type: 'string', enum: ['pending_validation', 'approved'] },
          },
        },
        requestId: { type: 'string' },
      },
    },
    401: ErrorResponseSchema,
    429: ErrorResponseSchema,
    502: ErrorResponseSchema,
    503: ErrorResponseSchema,
    504: ErrorResponseSchema,
  },
} as const satisfies FastifySchema;
