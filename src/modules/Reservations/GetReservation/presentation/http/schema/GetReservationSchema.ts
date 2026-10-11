import type { FastifySchema } from 'fastify';
import { ErrorResponseSchema } from '../../../../../../app/http/errors/ErrorResponseSchema.js';
import {
  ReservationBodySchema,
  ScoreSummarySchema,
} from '../../../../Shared/http/ReservationHttpSchemas.js';
import { ReservationIdParamsSchema } from '../../../../Shared/http/ReservationIdParams.js';

export const GetReservationSchema = {
  tags: ['Reservations'],
  summary: 'Consultar una reserva',
  description:
    'Devuelve el detalle factual de una reserva accesible, sus scores persistidos y hasUsableSnapshot. No ejecuta inferencias. Las probabilidades son exploratorias; riskLevel permanece null mientras riskPolicyStatus=pending_validation. Una reserva real sin evidencia histórica temporalmente verificable continúa NOT_SCORABLE.',
  security: [{ InternalApiKey: [] }],
  params: ReservationIdParamsSchema,
  response: {
    200: {
      description: 'Detalle factual de la reserva y scores persistidos, sin ejecutar inferencia.',
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
    503: {
      ...ErrorResponseSchema,
      description: 'Servicio, fuente de datos o persistencia no disponible.',
    },
  },
} as const satisfies FastifySchema;
