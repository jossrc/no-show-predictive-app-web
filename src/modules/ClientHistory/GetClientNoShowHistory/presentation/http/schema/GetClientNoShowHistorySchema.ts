import type { FastifySchema } from 'fastify';
import { ErrorResponseSchema } from '../../../../../../app/http/errors/ErrorResponseSchema.js';
import { ReservationIdParamsSchema } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';
import { HISTORICAL_AS_OF_MODES } from '../../../../Shared/models/HistoricalAsOf.js';

const nullableDateTime = { type: ['string', 'null'], format: 'date-time' } as const;

export const GetClientNoShowHistorySchema = {
  params: ReservationIdParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      historicalAsOf: {
        type: 'string',
        enum: [...HISTORICAL_AS_OF_MODES],
        default: 'booking_creation',
      },
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['data', 'requestId'],
      properties: {
        data: {
          type: 'object',
          additionalProperties: false,
          required: [
            'reservationId',
            'clientId',
            'historicalAsOf',
            'cutoffAt',
            'cutoffSemantics',
            'historySemantics',
            'previousAttended',
            'previousNoShow',
            'resolvedTotal',
            'noShowRate',
            'lastNoShowAt',
            'lastAttendedAt',
            'warnings',
          ],
          properties: {
            reservationId: { type: 'string' },
            clientId: { type: 'string' },
            historicalAsOf: { type: 'string', enum: [...HISTORICAL_AS_OF_MODES] },
            cutoffAt: { type: 'string', format: 'date-time' },
            cutoffSemantics: { type: 'string', enum: ['known_at < cutoffAt'] },
            historySemantics: { type: 'string', enum: ['NO_SHOW_CANDIDATE'] },
            previousAttended: { type: 'integer', minimum: 0 },
            previousNoShow: { type: 'integer', minimum: 0 },
            resolvedTotal: { type: 'integer', minimum: 0 },
            noShowRate: { type: ['number', 'null'], minimum: 0, maximum: 1 },
            lastNoShowAt: nullableDateTime,
            lastAttendedAt: nullableDateTime,
            warnings: { type: 'array', items: { type: 'string' } },
          },
        },
        requestId: { type: 'string' },
      },
    },
    400: ErrorResponseSchema,
    401: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    503: ErrorResponseSchema,
  },
} as const satisfies FastifySchema;
