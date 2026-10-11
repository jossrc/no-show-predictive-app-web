import type { FastifySchema } from 'fastify';
import { ErrorResponseSchema } from '../../../../../../app/http/errors/ErrorResponseSchema.js';
import { ReservationIdParamsSchema } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';
import { RiskAssessmentBodySchema } from '../../../../Shared/http/RiskHttpSchemas.js';

export const GetReservationRiskSchema = {
  params: ReservationIdParamsSchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['data', 'requestId'],
      properties: { data: RiskAssessmentBodySchema, requestId: { type: 'string' } },
    },
    400: ErrorResponseSchema,
    401: ErrorResponseSchema,
    404: ErrorResponseSchema,
    503: ErrorResponseSchema,
  },
} as const satisfies FastifySchema;
