import type { FastifySchema } from 'fastify';
import { ErrorResponseSchema } from '../../../../../../app/http/errors/ErrorResponseSchema.js';
import {
  DEFAULT_ML_MODEL_KEY,
  ML_MODEL_KEYS,
} from '../../../../../../infrastructure/http/ml/MlFeatureContract.js';
import { LISTABLE_RESERVATION_STATUSES } from '../../../../../Reservations/Shared/models/ReservationStatus.js';
import { ListItemSchema } from '../../../../Shared/http/RiskHttpSchemas.js';
import { RISK_LEVELS } from '../../../../Shared/policy/RiskLevelPolicy.js';

export const ListReservationRisksSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['from', 'to'],
    properties: {
      from: { type: 'string', format: 'date' },
      to: { type: 'string', format: 'date' },
      status: { type: 'string', enum: [...LISTABLE_RESERVATION_STATUSES], default: 'SCHEDULED' },
      clinicId: { type: 'string', pattern: '^[1-9][0-9]{0,8}$' },
      sort: {
        type: 'string',
        enum: ['appointmentAt', 'probabilityNoShow', 'riskLevel'],
        default: 'appointmentAt',
      },
      direction: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
      modelKey: { type: 'string', enum: [...ML_MODEL_KEYS], default: DEFAULT_ML_MODEL_KEY },
      riskLevel: { type: 'string', enum: [...RISK_LEVELS] },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      cursor: { type: 'string', minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$' },
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: [
        'data',
        'pagination',
        'period',
        'sort',
        'riskPolicyStatus',
        'classificationUnavailable',
        'sourceStatus',
        'predictiveStoreAvailable',
        'requestId',
      ],
      properties: {
        data: { type: 'array', items: ListItemSchema },
        pagination: {
          type: 'object',
          additionalProperties: false,
          required: ['limit', 'nextCursor'],
          properties: { limit: { type: 'integer' }, nextCursor: { type: ['string', 'null'] } },
        },
        period: {
          type: 'object',
          additionalProperties: false,
          required: ['from', 'to', 'timeZone', 'startInclusive', 'endExclusive'],
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            timeZone: { type: 'string' },
            startInclusive: { type: 'string', format: 'date-time' },
            endExclusive: { type: 'string', format: 'date-time' },
          },
        },
        sort: {
          type: 'object',
          additionalProperties: false,
          required: ['field', 'direction', 'modelKey', 'semantics'],
          properties: {
            field: { type: 'string' },
            direction: { type: 'string' },
            modelKey: { type: 'string' },
            semantics: { type: 'string' },
          },
        },
        riskPolicyStatus: { type: 'string' },
        classificationUnavailable: { type: 'boolean' },
        sourceStatus: { type: 'string' },
        predictiveStoreAvailable: { type: 'boolean' },
        requestId: { type: 'string' },
      },
    },
    400: ErrorResponseSchema,
    401: ErrorResponseSchema,
    409: ErrorResponseSchema,
    422: ErrorResponseSchema,
    503: ErrorResponseSchema,
  },
} as const satisfies FastifySchema;
