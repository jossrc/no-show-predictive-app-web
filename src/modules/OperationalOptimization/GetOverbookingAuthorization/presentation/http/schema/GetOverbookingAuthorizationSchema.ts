import type { FastifySchema } from 'fastify';
import { OVERBOOKING_STATUS_LABELS } from '../../../../../Reservations/Shared/http/OperationalStatusHttp.js';
import { ReservationIdParamsSchema } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';
import {
  CommonErrorResponses,
  EligibilitySchema,
  OverbookingAuthorizationSchema,
  ReservationNotFoundResponse,
} from '../../../../Shared/http/OperationalHttpSchemas.js';

export const GetOverbookingAuthorizationSchema = {
  tags: ['Operational optimization'],
  summary: 'HU-06 · Consultar estado y elegibilidad de sobreasignación',
  description:
    'Lectura pura (sin escrituras ni inferencia). Devuelve el estado explícito de la marca (ENABLED/NOT_ENABLED; authorization=null si no existe) y la elegibilidad calculada por el backend (overbooking_eligibility_v1): el FE muestra el botón solo si eligibility.eligible=true y envía al POST el modelKey y predictionRunId de un candidato elegible.',
  security: [{ InternalApiKey: [] }],
  params: ReservationIdParamsSchema,
  response: {
    200: {
      description: 'Estado de la marca y elegibilidad.',
      type: 'object',
      additionalProperties: false,
      required: ['data', 'requestId'],
      properties: {
        data: {
          type: 'object',
          additionalProperties: false,
          required: [
            'reservationId',
            'enabled',
            'status',
            'statusLabel',
            'authorization',
            'eligibility',
          ],
          properties: {
            reservationId: { type: 'string' },
            enabled: { type: 'boolean' },
            status: { type: 'string', enum: ['ENABLED', 'NOT_ENABLED'] },
            statusLabel: { type: 'string', enum: Object.values(OVERBOOKING_STATUS_LABELS) },
            authorization: { ...OverbookingAuthorizationSchema, type: ['object', 'null'] },
            eligibility: EligibilitySchema,
          },
        },
        requestId: { type: 'string' },
      },
    },
    ...CommonErrorResponses,
    ...ReservationNotFoundResponse,
  },
} as const satisfies FastifySchema;
