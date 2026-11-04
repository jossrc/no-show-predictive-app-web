import type { FastifySchema } from 'fastify';
import { ReservationIdParamsSchema } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';
import {
  AttendanceOutcomeSchema,
  CommonErrorResponses,
  ReservationNotFoundResponse,
} from '../../../../Shared/http/OperationalHttpSchemas.js';

export const GetAttendanceOutcomeSchema = {
  tags: ['Operational optimization'],
  summary: 'HU-07 · Consultar resultado real y comparación con la predicción',
  description:
    'Lectura pura. recorded=false ⇒ outcome=null y attendanceStatus=null (nunca un valor inferido). Si existe, devuelve la asistencia observada y las comparaciones GUARDADAS por modelo (no recalculadas). registration indica si el FE puede ofrecer el formulario (registrable) y por qué no (blocker: ALREADY_RECORDED, RESERVATION_CANCELLED, APPOINTMENT_NOT_STARTED, APPOINTMENT_IN_PROGRESS, APPOINTMENT_END_UNKNOWN, PREDICTION_REQUIRED).',
  security: [{ InternalApiKey: [] }],
  params: ReservationIdParamsSchema,
  response: {
    200: {
      description: 'Resultado real (o su ausencia explícita) y condiciones de registro.',
      type: 'object',
      additionalProperties: false,
      required: ['data', 'requestId'],
      properties: {
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['reservationId', 'recorded', 'attendanceStatus', 'outcome', 'registration'],
          properties: {
            reservationId: { type: 'string' },
            recorded: { type: 'boolean' },
            attendanceStatus: { type: ['string', 'null'], enum: ['ATTENDED', 'NO_SHOW', null] },
            outcome: { ...AttendanceOutcomeSchema, type: ['object', 'null'] },
            registration: {
              type: 'object',
              additionalProperties: false,
              required: ['ruleVersion', 'registrable', 'blocker', 'availablePredictionRunIds'],
              properties: {
                ruleVersion: { type: 'string', enum: ['appointment_finished_rule_v1'] },
                registrable: { type: 'boolean' },
                blocker: {
                  type: ['string', 'null'],
                  enum: [
                    'ALREADY_RECORDED',
                    'RESERVATION_CANCELLED',
                    'APPOINTMENT_NOT_STARTED',
                    'APPOINTMENT_IN_PROGRESS',
                    'APPOINTMENT_END_UNKNOWN',
                    'PREDICTION_REQUIRED',
                    null,
                  ],
                },
                availablePredictionRunIds: { type: 'array', items: { type: 'string' } },
              },
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
