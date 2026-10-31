import type { FastifySchema } from 'fastify';
import { ErrorResponseSchema } from '../../../../../../app/http/errors/ErrorResponseSchema.js';
import { ReservationIdParamsSchema } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';
import { HISTORICAL_AS_OF_MODES } from '../../../../Shared/models/HistoricalAsOf.js';

const nullableDateTime = { type: ['string', 'null'], format: 'date-time' } as const;

export const GetClientNoShowHistorySchema = {
  tags: ['Client History'],
  summary: 'Consultar historial del cliente de una reserva',
  description:
    'El cliente se deriva de la reserva accesible, sin admitir clientId como entrada. booking_creation utiliza únicamente el historial conocido antes de crear la reserva (known_at < cutoffAt). current_known es informativo y no modifica predicciones anteriores. historySemantics=NO_SHOW_CANDIDATE es una etiqueta proxy de posible inasistencia, no una ausencia confirmada. noShowRate es null cuando no hay historial resuelto.',
  security: [{ InternalApiKey: [] }],
  params: ReservationIdParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      historicalAsOf: {
        type: 'string',
        enum: [...HISTORICAL_AS_OF_MODES],
        default: 'booking_creation',
        description:
          'booking_creation consulta el historial conocido antes de crear la reserva; current_known es informativo y no modifica predicciones anteriores.',
        examples: ['booking_creation'],
      },
    },
  },
  response: {
    200: {
      description:
        'Historial con etiqueta proxy NO_SHOW_CANDIDATE y corte temporal explícito; no son ausencias confirmadas.',
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
        'HISTORY_CUTOFF_UNAVAILABLE: no se puede establecer el corte temporal del historial.',
    },
    503: {
      ...ErrorResponseSchema,
      description: 'Servicio, fuente de datos o persistencia no disponible.',
    },
  },
} as const satisfies FastifySchema;
