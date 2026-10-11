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
  response: { 200: body, 503: body },
} as const satisfies FastifySchema;
