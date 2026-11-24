import type { FastifySchema } from 'fastify';
import {
  CommonErrorResponses,
  ListQueryErrorResponses,
  listResponseSchema,
  AttendanceOutcomeSchema,
  RecordListQuerySchema,
} from '../../../../Shared/http/OperationalHttpSchemas.js';

export const ListAttendanceOutcomesSchema = {
  tags: ['Operational optimization'],
  summary: 'HU-07 · Listar resultados reales registrados',
  description:
    'Lista paginada de asistencias observadas con su vínculo a la predicción y las comparaciones por modelo (insumo para la evaluación futura HU-12; no calcula métricas ni reportes). Filtro por fecha de CITA en America/Lima (from/to, máx. 92 días), sede y alcance; orden appointmentAt ASC, reservationId ASC. Comparaciones leídas por lote (sin N+1).',
  security: [{ InternalApiKey: [] }],
  querystring: RecordListQuerySchema,
  response: {
    200: listResponseSchema(
      AttendanceOutcomeSchema,
      'Página de registros y cursor de la siguiente.',
    ),
    ...CommonErrorResponses,
    ...ListQueryErrorResponses,
  },
} as const satisfies FastifySchema;
