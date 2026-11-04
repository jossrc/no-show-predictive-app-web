import type { FastifySchema } from 'fastify';
import { ReservationIdParamsSchema } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';
import {
  CommonErrorResponses,
  ReservationNotFoundResponse,
  SpaceRecoveryOutcomeSchema,
} from '../../../../Shared/http/OperationalHttpSchemas.js';

export const GetSpaceRecoveryOutcomeSchema = {
  tags: ['Operational optimization'],
  summary: 'HU-08 · Consultar resultado de recuperación del espacio',
  description:
    'Lectura pura. recorded=false ⇒ spaceRecovered=null (sin registro); recorded=true ⇒ spaceRecovered true/false (false = gestionado sin recuperar). preventiveAction expone el vínculo con la habilitación HU-06; registrable/blocker indican si el FE puede ofrecer Sí/No (PREVENTIVE_ACTION_REQUIRED, ALREADY_RECORDED).',
  security: [{ InternalApiKey: [] }],
  params: ReservationIdParamsSchema,
  response: {
    200: {
      description: 'Resultado de recuperación (o su ausencia explícita) y gestión HU-06.',
      type: 'object',
      additionalProperties: false,
      required: ['data', 'requestId'],
      properties: {
        data: {
          type: 'object',
          additionalProperties: false,
          required: [
            'reservationId',
            'recorded',
            'spaceRecovered',
            'outcome',
            'preventiveAction',
            'registrable',
            'blocker',
          ],
          properties: {
            reservationId: { type: 'string' },
            recorded: { type: 'boolean' },
            spaceRecovered: { type: ['boolean', 'null'] },
            outcome: { ...SpaceRecoveryOutcomeSchema, type: ['object', 'null'] },
            preventiveAction: {
              type: 'object',
              additionalProperties: false,
              required: ['enabled', 'authorizationId'],
              properties: {
                enabled: { type: 'boolean' },
                authorizationId: { type: ['string', 'null'] },
              },
            },
            registrable: { type: 'boolean' },
            blocker: {
              type: ['string', 'null'],
              enum: ['PREVENTIVE_ACTION_REQUIRED', 'ALREADY_RECORDED', null],
            },
          },
        },
        requestId: { type: 'string' },
      },
    },
    ...CommonErrorResponses,
    ...ReservationNotFoundResponse,
  },
} as const satisfies FastifySchema;
