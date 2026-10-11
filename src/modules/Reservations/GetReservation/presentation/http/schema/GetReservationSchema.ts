import type { FastifySchema } from 'fastify';
import { ErrorResponseSchema } from '../../../../../../app/http/errors/ErrorResponseSchema.js';
import {
  ReservationBodySchema,
  ScoreSummarySchema,
} from '../../../../Shared/http/ReservationHttpSchemas.js';
import { ReservationIdParamsSchema } from '../../../../Shared/http/ReservationIdParams.js';

export const GetReservationSchema = {
  params: ReservationIdParamsSchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['data', 'requestId'],
      properties: {
        data: {
          ...ReservationBodySchema,
          required: [
            ...ReservationBodySchema.required,
            'hasUsableSnapshot',
            'scores',
            'sourceStatus',
          ],
          properties: {
            ...ReservationBodySchema.properties,
            hasUsableSnapshot: { type: 'boolean' },
            scores: { type: 'array', items: ScoreSummarySchema },
            sourceStatus: { type: 'string' },
          },
        },
        requestId: { type: 'string' },
      },
    },
    400: ErrorResponseSchema,
    401: ErrorResponseSchema,
    404: ErrorResponseSchema,
    503: ErrorResponseSchema,
  },
} as const satisfies FastifySchema;
