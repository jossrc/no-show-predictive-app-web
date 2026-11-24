import type { FastifySchema } from 'fastify';
import { PRIORITY_CLIENT_CSV_HEADERS } from '../../../../Shared/export/PriorityClientCsv.js';
import {
  PriorityClientFilterProperties,
  RetentionQueryErrorResponses,
} from '../../../../Shared/http/RetentionHttpSchemas.js';

export const ExportPriorityClientsSchema = {
  tags: ['Customer retention'],
  summary: 'Exportar clientes prioritarios (CSV compatible con Excel)',
  description: `Descarga el 100 % de las filas que cumplen los mismos criterios, filtros y orden que GET /retention/priority-clients (misma consulta, recorrida por lotes en streaming; sin paginación). CSV UTF-8 con BOM, todas las celdas entrecomilladas, contenido con prefijo de fórmula (= + - @ tab) neutralizado con apóstrofo. Identificadores exactos como texto. Columnas: ${PRIORITY_CLIENT_CSV_HEADERS.join(' | ')}. Sin nombres, documentos, teléfonos ni correos.`,
  security: [{ InternalApiKey: [] }],
  produces: ['text/csv'],
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...PriorityClientFilterProperties,
      delimiter: {
        type: 'string',
        enum: ['comma', 'semicolon'],
        default: 'comma',
        description:
          'Separador de columnas: comma (RFC 4180) o semicolon (Excel con configuración regional que usa coma decimal).',
      },
    },
  },
  response: {
    200: {
      description:
        'Archivo CSV (Content-Disposition: attachment; filename="clientes-prioritarios-retencion_<modelo>_<AAAAMMDD-HHmm>.csv").',
      content: { 'text/csv': { schema: { type: 'string' } } },
    },
    ...RetentionQueryErrorResponses,
  },
} as const satisfies FastifySchema;
