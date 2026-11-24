import type { FastifySchema } from 'fastify';
import {
  PriorityClientFilterProperties,
  PriorityClientItemSchema,
  RetentionQueryContextProperties,
  RetentionQueryErrorResponses,
} from '../../../../Shared/http/RetentionHttpSchemas.js';

export const ListPriorityClientsSchema = {
  tags: ['Customer retention'],
  summary: 'Listar clientes prioritarios para retención',
  description:
    'Reservas SCHEDULED con cita futura dentro de la ventana móvil de 72 h cuyo ÚLTIMO score persistido del modelo elegido tiene banda EXPERIMENTAL HIGH bajo la política research vigente (retention_priority_v1). Una fila por reserva: un cliente con varias citas próximas aparece una vez por cita. Incluye reservas de la fuente y reservas incorporadas por archivo. Solo lectura: no genera predicciones ni llama a Python. riskLevel operativo permanece null; la banda es exploratoria (operationalUseAllowed=false). Sin política research vigente: lista vacía con experimentalClassificationUnavailable=true. Paginación keyset con cursor opaco firmado (conservar filtros y orden).',
  security: [{ InternalApiKey: [] }],
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...PriorityClientFilterProperties,
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      cursor: {
        type: 'string',
        minLength: 1,
        maxLength: 512,
        pattern: '^[A-Za-z0-9_-]+$',
        description: 'pagination.nextCursor de la página anterior (mismos filtros y orden).',
      },
    },
  },
  response: {
    200: {
      description: 'Página de clientes prioritarios con su estado de gestión de retención.',
      type: 'object',
      additionalProperties: false,
      required: [
        'data',
        'pagination',
        'window',
        'sort',
        'filters',
        'experimentalClassificationUnavailable',
        'experimentalRiskPolicy',
        'riskPolicyStatus',
        'predictiveStoreAvailable',
        'requestId',
      ],
      properties: {
        data: { type: 'array', items: PriorityClientItemSchema },
        pagination: {
          type: 'object',
          additionalProperties: false,
          required: ['limit', 'nextCursor'],
          properties: { limit: { type: 'integer' }, nextCursor: { type: ['string', 'null'] } },
        },
        ...RetentionQueryContextProperties,
        riskPolicyStatus: { type: 'string' },
        predictiveStoreAvailable: { type: 'boolean' },
        requestId: { type: 'string' },
      },
    },
    ...RetentionQueryErrorResponses,
  },
} as const satisfies FastifySchema;
