import type { FastifySchema } from 'fastify';
import { ErrorResponseSchema } from '../../../../../../app/http/errors/ErrorResponseSchema.js';
import { ML_MODEL_KEYS } from '../../../../../../infrastructure/http/ml/MlFeatureContract.js';
import { DECIMAL_ID_PATTERN } from '../../../../../../shared/identifiers/DecimalId.js';
import { ReservationIdParamsSchema } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';
import {
  RETENTION_INELIGIBILITY_CODES,
  RetentionContactSchema,
} from '../../../../Shared/http/RetentionHttpSchemas.js';

const PREDICTION_RUN_ID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

const responseBody = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'requestId'],
  properties: {
    data: {
      ...RetentionContactSchema,
      required: [...RetentionContactSchema.required, 'replayed'],
      properties: {
        ...RetentionContactSchema.properties,
        replayed: { type: 'boolean', description: 'true en reintento idéntico (HTTP 200).' },
      },
    },
    requestId: { type: 'string' },
  },
} as const;

export const RecordRetentionContactSchema = {
  tags: ['Customer retention'],
  summary: 'Registrar una acción de retención realizada',
  description:
    'Registra que se REALIZÓ un contacto o campaña de retención para la reserva (no envía mensajes, correos, SMS ni WhatsApp). Verifica: reserva existente y accesible, titularidad del cliente, retention_priority_v1 (SCHEDULED, cita en las próximas 72 h, predicción indicada = última del modelo con banda HIGH bajo la política vigente) y ausencia de un registro previo. Unidad de gestión: la reserva (una por cita; no marca otras reservas del cliente). Fecha, riesgo, sede y autoría las resuelve el servidor. 201 crea; 200 reintento idéntico (replayed=true, fecha original intacta); 409 si no es elegible, la predicción no pertenece a la reserva, el cliente no coincide o ya existe una acción con otra predicción. Cuerpo JSON estricto (sin coerción), máximo 1024 bytes.',
  security: [{ InternalApiKey: [] }],
  params: ReservationIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['clientId', 'modelKey', 'predictionRunId'],
    examples: [
      {
        clientId: '900000000002001',
        modelKey: 'xgboost_full_v1',
        predictionRunId: '00000000-0000-4000-8000-000000000001',
      },
    ],
    properties: {
      clientId: {
        type: 'string',
        pattern: DECIMAL_ID_PATTERN,
        description: 'Titular de la reserva (se verifica; cadena decimal).',
      },
      modelKey: { type: 'string', enum: [...ML_MODEL_KEYS] },
      predictionRunId: {
        type: 'string',
        pattern: PREDICTION_RUN_ID_PATTERN,
        description:
          'predictionRunId de la estimación mostrada en el listado (prediction.predictionRunId).',
      },
    },
  },
  response: {
    200: { ...responseBody, description: 'Reintento idéntico: registro existente, sin INSERT.' },
    201: { ...responseBody, description: 'Acción registrada en ml.app_retention_contacts.' },
    400: { ...ErrorResponseSchema, description: 'REQUEST_VALIDATION_ERROR (cuerpo o parámetros).' },
    401: { ...ErrorResponseSchema, description: 'Credencial x-api-key ausente o inválida.' },
    404: {
      ...ErrorResponseSchema,
      description: 'RESERVATION_NOT_FOUND: inexistente o fuera del alcance (no se revela cuál).',
    },
    409: {
      ...ErrorResponseSchema,
      description: `RETENTION_NOT_ELIGIBLE (details.reasons: ${RETENTION_INELIGIBILITY_CODES.join(', ')}), PREDICTION_RESERVATION_MISMATCH, RESERVATION_CLIENT_MISMATCH o RETENTION_CONTACT_ALREADY_RECORDED.`,
    },
    413: { ...ErrorResponseSchema, description: 'PAYLOAD_TOO_LARGE: cuerpo mayor a 1024 bytes.' },
    503: {
      ...ErrorResponseSchema,
      description: 'PERSISTENCE_UNAVAILABLE o SOURCE_DATA_UNAVAILABLE.',
    },
  },
} as const satisfies FastifySchema;
