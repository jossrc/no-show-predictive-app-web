import type { FastifySchema } from 'fastify';
import { ErrorResponseSchema } from '../../../../../../app/http/errors/ErrorResponseSchema.js';
import { ReservationIdParamsSchema } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';
import {
  AttendanceOutcomeSchema,
  CommonErrorResponses,
  PREDICTION_RUN_ID_PATTERN,
  ReservationNotFoundResponse,
  SYNTHETIC_EXAMPLES,
} from '../../../../Shared/http/OperationalHttpSchemas.js';

const responseBody = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'requestId'],
  properties: {
    data: {
      ...AttendanceOutcomeSchema,
      required: [...AttendanceOutcomeSchema.required, 'replayed'],
      properties: {
        ...AttendanceOutcomeSchema.properties,
        replayed: { type: 'boolean', description: 'true en reintento idéntico (HTTP 200).' },
      },
    },
    requestId: { type: 'string' },
  },
} as const;

export const RecordAttendanceOutcomeSchema = {
  tags: ['Operational optimization'],
  summary: 'HU-07 · Registrar el resultado real de la cita',
  description:
    'Registra explícitamente si el cliente ASISTIÓ (ATTENDED) o NO ASISTIÓ (NO_SHOW) a una cita FINALIZADA (appointment_finished_rule_v1: reserva no cancelada, inicio vencido y la fuente la clasifica PAST o su fin programado en FLOWww ya pasó) y lo asocia al run de predicción indicado de ESA reserva. Guarda una comparación por modelo del run (binary_outcome_threshold_v1: p >= 0.5 ⇒ inasistencia predicha; umbral técnico provisional, no validado). No recalcula ni modifica predicciones, no llama a Python y no escribe en FLOWww. 201 crea; 200 reintento idéntico; 409 si ya existe otro valor (no se sobrescribe). Cuerpo JSON estricto, máximo 1024 bytes.',
  security: [{ InternalApiKey: [] }],
  params: ReservationIdParamsSchema,
  body: {
    description: 'Ejemplo sintético.',
    examples: [
      { attendanceStatus: 'NO_SHOW', predictionRunId: SYNTHETIC_EXAMPLES.predictionRunId },
    ],
    type: 'object',
    additionalProperties: false,
    required: ['attendanceStatus', 'predictionRunId'],
    properties: {
      attendanceStatus: {
        type: 'string',
        enum: ['ATTENDED', 'NO_SHOW'],
        description: 'Observación real registrada por recepción. Una cancelación NO es NO_SHOW.',
      },
      predictionRunId: {
        type: 'string',
        pattern: PREDICTION_RUN_ID_PATTERN,
        description:
          'Run de predicción previo de esta reserva (p. ej. registration.availablePredictionRunIds del GET).',
      },
    },
  },
  response: {
    200: { ...responseBody, description: 'Reintento idéntico: registro existente, sin INSERT.' },
    201: { ...responseBody, description: 'Resultado y comparaciones guardados.' },
    ...CommonErrorResponses,
    ...ReservationNotFoundResponse,
    409: {
      ...ErrorResponseSchema,
      description:
        'APPOINTMENT_NOT_FINISHED (details.reason: APPOINTMENT_NOT_STARTED, APPOINTMENT_IN_PROGRESS, APPOINTMENT_END_UNKNOWN), RESERVATION_CANCELLED, PREDICTION_REQUIRED, PREDICTION_RESERVATION_MISMATCH, PREDICTION_AFTER_APPOINTMENT o ATTENDANCE_ALREADY_RECORDED_CONFLICT.',
    },
    413: { ...ErrorResponseSchema, description: 'PAYLOAD_TOO_LARGE: cuerpo mayor a 1024 bytes.' },
  },
} as const satisfies FastifySchema;
