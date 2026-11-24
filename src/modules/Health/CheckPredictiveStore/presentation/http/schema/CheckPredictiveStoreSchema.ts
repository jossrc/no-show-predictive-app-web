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
    'restrictedRole',
    'sourceDatabaseWritable',
  ],
  properties: {
    service: { type: 'string', enum: ['predictive-store'] },
    status: { type: 'string', enum: ['ok', 'error', 'disabled'] },
    message: { type: 'string' },
    driver: { type: ['string', 'null'], enum: ['postgresql', null] },
    schemaVersion: { type: ['string', 'null'] },
    dataSourceMode: {
      type: ['string', 'null'],
      enum: ['READ_ONLY_EXISTING_SCHEDULE', 'SYNTHETIC_DEMO_ONLY', null],
    },
    durable: { type: 'boolean' },
    restrictedRole: {
      type: ['boolean', 'null'],
      description:
        'true si el rol runtime no es superusuario ni puede crear objetos en ml (privilegios mínimos).',
    },
    sourceDatabaseWritable: { type: 'boolean', enum: [false] },
  },
} as const;

export const CheckPredictiveStoreSchema = {
  tags: ['Health'],
  summary: 'Consultar el almacén predictivo PostgreSQL',
  description:
    'Estado del almacén PostgreSQL PROPIO de la app (tablas ml.app_*, ADR-008) donde se persisten snapshots, runs y scores research v2 y los registros HU-06/07/08: driver=postgresql, versión de esquema, modo de datos ligado y si el rol runtime es restringido. Las tablas fuente raw_flow/analytics nunca se escriben (sourceDatabaseWritable=false). No expone credenciales, host, nombres de base ni datos.',
  security: [],
  response: {
    200: { ...body, description: 'Almacén disponible o no inicializado (status=disabled).' },
    503: { ...body, description: 'Almacén con error de integridad o versión (status=error).' },
  },
} as const satisfies FastifySchema;
