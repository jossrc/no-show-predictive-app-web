import type { FastifySchema } from 'fastify';
import { ErrorResponseSchema } from '../../../../../../app/http/errors/ErrorResponseSchema.js';
import { ReservationIdParamsSchema } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';
import {
  CommonErrorResponses,
  ReservationNotFoundResponse,
  SpaceRecoveryOutcomeSchema,
} from '../../../../Shared/http/OperationalHttpSchemas.js';

const responseBody = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'requestId'],
  properties: {
    data: {
      ...SpaceRecoveryOutcomeSchema,
      required: [...SpaceRecoveryOutcomeSchema.required, 'replayed'],
      properties: {
        ...SpaceRecoveryOutcomeSchema.properties,
        replayed: { type: 'boolean', description: 'true en reintento idéntico (HTTP 200).' },
      },
    },
    requestId: { type: 'string' },
  },
} as const;

export const RecordSpaceRecoveryOutcomeSchema = {
  tags: ['Operational optimization'],
  summary: 'HU-08 · Registrar si el espacio fue recuperado',
  description:
    'Registra explícitamente el resultado operativo (spaceRecovered: true = recuperado; false = gestionado sin recuperar) de un horario con habilitación HU-06 previa; se vincula a esa autorización (mismo horario y sede). Sin habilitación previa responde 409 PREVENTIVE_ACTION_REQUIRED sin escribir. No se infiere de la asistencia (HU-07 no es requisito) ni crea/modifica citas en FLOWww. Cuerpo JSON estricto: solo booleanos JSON (rechaza null, "true", 1). 201 crea; 200 reintento idéntico; 409 si ya existe otro valor.',
  security: [{ InternalApiKey: [] }],
  params: ReservationIdParamsSchema,
  body: {
    description: 'Ejemplos sintéticos.',
    examples: [{ spaceRecovered: true }, { spaceRecovered: false }],
    type: 'object',
    additionalProperties: false,
    required: ['spaceRecovered'],
    properties: {
      spaceRecovered: { type: 'boolean', description: 'Booleano JSON obligatorio (Sí/No).' },
    },
  },
  response: {
    200: { ...responseBody, description: 'Reintento idéntico: registro existente, sin INSERT.' },
    201: { ...responseBody, description: 'Resultado de recuperación guardado.' },
    ...CommonErrorResponses,
    ...ReservationNotFoundResponse,
    409: {
      ...ErrorResponseSchema,
      description:
        'PREVENTIVE_ACTION_REQUIRED (sin habilitación HU-06) o SPACE_RECOVERY_ALREADY_RECORDED_CONFLICT.',
    },
    413: { ...ErrorResponseSchema, description: 'PAYLOAD_TOO_LARGE: cuerpo mayor a 1024 bytes.' },
  },
} as const satisfies FastifySchema;
