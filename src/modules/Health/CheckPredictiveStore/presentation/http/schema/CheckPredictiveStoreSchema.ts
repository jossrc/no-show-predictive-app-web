import type { FastifySchema } from 'fastify';

const body = {
  type: 'object',
  additionalProperties: false,
  required: [
    'service',
    'status',
    'message',
    'driver',
    'schemaVersion',
    'dataSourceMode',
    'durable',
    'sourceDatabaseWritable',
  ],
  properties: {
    service: { type: 'string', enum: ['predictive-store'] },
    status: { type: 'string', enum: ['ok', 'error', 'disabled'] },
    message: { type: 'string' },
    driver: { type: ['string', 'null'], enum: ['sqlite', null] },
    schemaVersion: { type: ['string', 'null'] },
    dataSourceMode: {
      type: ['string', 'null'],
      enum: ['READ_ONLY_EXISTING_SCHEDULE', 'SYNTHETIC_DEMO_ONLY', null],
    },
    durable: { type: 'boolean' },
    sourceDatabaseWritable: { type: 'boolean', enum: [false] },
  },
} as const;

export const CheckPredictiveStoreSchema = {
  tags: ['Health'],
  summary: 'Consultar el almacén predictivo local',
  description:
    'Estado del almacén local SQLite donde la app persiste snapshots, runs y scores (con su banda experimental). PostgreSQL es fuente de solo lectura (sourceDatabaseWritable=false). No expone rutas de archivo, tamaños ni datos.',
  security: [],
  response: {
    200: { ...body, description: 'Almacén disponible o no inicializado (status=disabled).' },
    503: { ...body, description: 'Almacén con error de integridad o versión (status=error).' },
  },
} as const satisfies FastifySchema;
