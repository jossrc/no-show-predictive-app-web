import type { FastifySchema } from 'fastify';
import {
  CommonErrorResponses,
  ListQueryErrorResponses,
  listResponseSchema,
  SpaceRecoveryOutcomeSchema,
  RecordListQuerySchema,
} from '../../../../Shared/http/OperationalHttpSchemas.js';

export const ListSpaceRecoveryOutcomesSchema = {
  tags: ['Operational optimization'],
  summary: 'HU-08 · Listar espacios recuperados registrados',
  description:
    'Lista paginada de resultados de recuperación (spaceRecovered true/false) vinculados a su habilitación HU-06, para la contabilización futura HU-13 (sin reportes en Sprint 02). Filtro por fecha de CITA en America/Lima (from/to, máx. 92 días), sede y alcance; orden appointmentAt ASC, reservationId ASC.',
  security: [{ InternalApiKey: [] }],
  querystring: RecordListQuerySchema,
  response: {
    200: listResponseSchema(
      SpaceRecoveryOutcomeSchema,
      'Página de registros y cursor de la siguiente.',
    ),
    ...CommonErrorResponses,
    ...ListQueryErrorResponses,
  },
} as const satisfies FastifySchema;
