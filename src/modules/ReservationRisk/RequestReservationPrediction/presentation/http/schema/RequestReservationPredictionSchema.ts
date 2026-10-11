import type { FastifySchema } from 'fastify';
import { ErrorResponseSchema } from '../../../../../../app/http/errors/ErrorResponseSchema.js';
import { ML_MODEL_KEYS } from '../../../../../../infrastructure/http/ml/MlFeatureContract.js';
import { ReservationIdParamsSchema } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';
import { RiskAssessmentBodySchema } from '../../../../Shared/http/RiskHttpSchemas.js';

const responseBody = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'requestId'],
  properties: {
    data: {
      ...RiskAssessmentBodySchema,
      required: [...RiskAssessmentBodySchema.required, 'run', 'featureWarnings'],
      properties: {
        ...RiskAssessmentBodySchema.properties,
        run: {
          type: 'object',
          additionalProperties: false,
          required: ['predictionRunId', 'replayed', 'requestedModelKeys', 'snapshotCreated'],
          properties: {
            predictionRunId: { type: ['string', 'null'] },
            replayed: { type: 'boolean' },
            requestedModelKeys: { type: 'array', items: { type: 'string' } },
            snapshotCreated: { type: 'boolean' },
          },
        },
        featureWarnings: { type: 'array', items: { type: 'string' } },
      },
    },
    requestId: { type: 'string' },
  },
} as const;

export const RequestReservationPredictionSchema = {
  params: ReservationIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['mode'],
    properties: {
      mode: { type: 'string', enum: ['compare', 'single'] },
      modelKey: { type: 'string', enum: [...ML_MODEL_KEYS] },
    },
    // single exige modelKey; compare lo prohíbe (sin fallback silencioso de modelo).
    if: { properties: { mode: { const: 'single' } } },
    then: { required: ['mode', 'modelKey'] },
    else: { not: { required: ['modelKey'] } },
  },
  response: {
    200: responseBody,
    201: responseBody,
    400: ErrorResponseSchema,
    401: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    413: ErrorResponseSchema,
    422: ErrorResponseSchema,
    429: ErrorResponseSchema,
    502: ErrorResponseSchema,
    503: ErrorResponseSchema,
    504: ErrorResponseSchema,
  },
} as const satisfies FastifySchema;
