import type { FastifySchema } from 'fastify';

const body = {
  type: 'object',
  additionalProperties: false,
  required: ['service', 'status', 'message', 'servingStatus', 'operationalUseAllowed'],
  properties: {
    service: { type: 'string', enum: ['ml'] },
    status: { type: 'string', enum: ['ok', 'error', 'disabled'] },
    message: { type: 'string' },
    servingStatus: { type: ['string', 'null'], enum: ['EXPLORATORY_NOT_VALIDATED', null] },
    operationalUseAllowed: { type: 'boolean', enum: [false] },
  },
} as const;

export const CheckMlServiceSchema = {
  tags: ['Health'],
  summary: 'Consultar disponibilidad del servicio ML',
  description:
    'Comprobación pública de disponibilidad del microservicio interno. No ejecuta inferencias ni solicita la credencial de Python. Un servicio disponible continúa siendo exploratorio: servingStatus=EXPLORATORY_NOT_VALIDATED y operationalUseAllowed=false.',
  security: [],
  response: {
    200: {
      ...body,
      description:
        'Servicio ML disponible para uso exploratorio o deshabilitado (status=disabled).',
    },
    503: {
      ...body,
      description: 'Servicio ML no disponible (status=error).',
    },
  },
} as const satisfies FastifySchema;
