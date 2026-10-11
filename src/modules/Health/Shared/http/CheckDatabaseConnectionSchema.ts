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
  tags: ['Health'],
  security: [],
  response: {
    200: {
      ...connectionBody,
      description: 'Conexión disponible o conexión opcional deshabilitada.',
    },
    503: {
      ...connectionBody,
      description: 'La conexión a la base de datos no está disponible.',
    },
  },
} as const satisfies FastifySchema;
