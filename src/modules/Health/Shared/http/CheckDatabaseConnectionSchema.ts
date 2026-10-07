import type { FastifySchema } from 'fastify';

const connectionBody = {
  type: 'object',
  additionalProperties: false,
  required: ['database', 'status', 'message'],
  properties: {
    database: { type: 'string', enum: ['postgres', 'mysql'] },
    status: { type: 'string', enum: ['ok', 'error', 'disabled'] },
    message: { type: 'string' },
  },
} as const;

export const CheckDatabaseConnectionSchema = {
  response: {
    200: connectionBody,
    503: connectionBody,
  },
} as const satisfies FastifySchema;
