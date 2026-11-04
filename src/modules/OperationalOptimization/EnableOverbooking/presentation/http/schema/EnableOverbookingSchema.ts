import type { FastifySchema } from 'fastify';
import { ErrorResponseSchema } from '../../../../../../app/http/errors/ErrorResponseSchema.js';
import { ML_MODEL_KEYS } from '../../../../../../infrastructure/http/ml/MlFeatureContract.js';
import { ReservationIdParamsSchema } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';
import {
  CommonErrorResponses,
  OverbookingAuthorizationSchema,
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
      ...OverbookingAuthorizationSchema,
      required: [...OverbookingAuthorizationSchema.required, 'enabled', 'replayed'],
      properties: {
        ...OverbookingAuthorizationSchema.properties,
        enabled: { type: 'boolean', enum: [true] },
        replayed: { type: 'boolean', description: 'true en reintento idéntico (HTTP 200).' },
      },
    },
    requestId: { type: 'string' },
  },
} as const;

export const EnableOverbookingSchema = {
  tags: ['Operational optimization'],
  summary: 'HU-06 · Habilitar horario para sobreasignación',
  description:
    'Registra la marca «Habilitado para sobreasignación» de una reserva cuyo ÚLTIMO score del modelo elegido tiene banda experimental HIGH bajo la política research vigente (regla overbooking_eligibility_v1), con cita futura y reserva SCHEDULED. Es una autorización manual para análisis posterior del Call Center: NO crea citas, NO libera agenda, NO modifica la reserva en FLOWww ni llama a Python. El cliente solo envía modelKey y predictionRunId (de GET …/overbooking-authorization → eligibility.candidates); riesgo, sede, fechas y autoría se calculan en el servidor. 201 crea; 200 reintento idéntico (replayed=true); 409 si no es elegible, la predicción no es la última del modelo, no pertenece a la reserva o ya existe una marca con otra predicción. Cuerpo JSON estricto (sin coerción de tipos), máximo 1024 bytes.',
  security: [{ InternalApiKey: [] }],
  params: ReservationIdParamsSchema,
  body: {
    description: 'Ejemplo sintético.',
    examples: [
      { modelKey: 'random_forest_full_v1', predictionRunId: SYNTHETIC_EXAMPLES.predictionRunId },
    ],
    type: 'object',
    additionalProperties: false,
    required: ['modelKey', 'predictionRunId'],
    properties: {
      modelKey: {
        type: 'string',
        enum: [...ML_MODEL_KEYS],
        description: 'Modelo cuya predicción HIGH justifica la marca (sin ensemble).',
      },
      predictionRunId: {
        type: 'string',
        pattern: PREDICTION_RUN_ID_PATTERN,
        description: 'predictionRunId (UUID) del último score del modelo en esta reserva.',
      },
    },
  },
  response: {
    200: { ...responseBody, description: 'Reintento idéntico: marca existente, sin INSERT nuevo.' },
    201: { ...responseBody, description: 'Marca creada en ml.app_overbooking_authorizations.' },
    ...CommonErrorResponses,
    ...ReservationNotFoundResponse,
    409: {
      ...ErrorResponseSchema,
      description:
        'OVERBOOKING_NOT_ELIGIBLE (details.reasons: RESERVATION_NOT_SCHEDULED, APPOINTMENT_NOT_FUTURE, NOT_SCORED, EXPERIMENTAL_BAND_UNAVAILABLE, PREDICTION_NOT_HIGH, RESEARCH_POLICY_NOT_CURRENT, PREDICTION_NOT_LATEST), PREDICTION_RESERVATION_MISMATCH u OVERBOOKING_ALREADY_ENABLED_CONFLICT.',
    },
    413: { ...ErrorResponseSchema, description: 'PAYLOAD_TOO_LARGE: cuerpo mayor a 1024 bytes.' },
  },
} as const satisfies FastifySchema;
