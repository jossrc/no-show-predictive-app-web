import type { FastifySchema } from 'fastify';
import {
  CommonErrorResponses,
  ListQueryErrorResponses,
  listResponseSchema,
  OverbookingAuthorizationSchema,
  RecordListQuerySchema,
} from '../../../../Shared/http/OperationalHttpSchemas.js';

export const ListOverbookingAuthorizationsSchema = {
  tags: ['Operational optimization'],
  summary: 'HU-06 · Listar horarios habilitados para sobreasignación',
  description:
    'Lista paginada (keyset, orden appointmentAt ASC, reservationId ASC) de las marcas HU-06 guardadas en el almacén de la app, filtradas por fecha de CITA en el calendario America/Lima (from/to inclusivos, máx. 92 días), sede y alcance del consumidor. Solo lectura: no consulta FLOWww ni Python.',
  security: [{ InternalApiKey: [] }],
  querystring: RecordListQuerySchema,
  response: {
    200: listResponseSchema(
      OverbookingAuthorizationSchema,
      'Página de registros y cursor de la siguiente.',
    ),
    ...CommonErrorResponses,
    ...ListQueryErrorResponses,
  },
} as const satisfies FastifySchema;
