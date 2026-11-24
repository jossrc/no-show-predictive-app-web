import type { FastifySchema } from 'fastify';
import { ErrorResponseSchema } from '../../../../../../app/http/errors/ErrorResponseSchema.js';
import { DECIMAL_ID_PATTERN } from '../../../../../../shared/identifiers/DecimalId.js';
import {
  FILE_ERROR_MESSAGES,
  IMPORT_COLUMNS,
  OPTIONAL_IMPORT_FIELDS,
  REQUIRED_IMPORT_FIELDS,
  RESERVATION_IMPORT_CONTRACT_VERSION,
  ROW_REJECTION_MESSAGES,
} from '../../../../Shared/contract/ReservationImportContract.js';
import { IMPORT_BATCH_STATUS_LABELS } from '../../../../Shared/http/ImportHttpMapper.js';

const rowError = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'field', 'message'],
  properties: {
    code: { type: 'string', enum: Object.keys(ROW_REJECTION_MESSAGES) },
    field: {
      type: ['string', 'null'],
      description: 'Columna del contrato (null = fila completa).',
    },
    message: { type: 'string' },
  },
} as const;

const requiredColumns = REQUIRED_IMPORT_FIELDS.map((field) => IMPORT_COLUMNS[field]).join(', ');
const optionalColumns = OPTIONAL_IMPORT_FIELDS.map((field) => IMPORT_COLUMNS[field]).join(', ');

const responseBody = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'requestId'],
  properties: {
    data: {
      type: 'object',
      additionalProperties: false,
      required: [
        'batchId',
        'contractVersion',
        'fileFormat',
        'fileSha256',
        'fileSizeBytes',
        'status',
        'statusLabel',
        'processedAt',
        'totalRows',
        'acceptedRows',
        'rejectedRows',
        'acceptedReservations',
        'rejectedRowDetails',
        'rejectionSummary',
        'ignoredColumns',
        'predictionsGenerated',
        'notice',
        'actorKind',
        'actorUserId',
      ],
      properties: {
        batchId: { type: 'string', format: 'uuid' },
        contractVersion: { type: 'string', enum: [RESERVATION_IMPORT_CONTRACT_VERSION] },
        fileFormat: { type: 'string', enum: ['CSV', 'XLSX'] },
        fileSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        fileSizeBytes: { type: 'integer', minimum: 1 },
        status: { type: 'string', enum: Object.keys(IMPORT_BATCH_STATUS_LABELS) },
        statusLabel: { type: 'string', enum: Object.values(IMPORT_BATCH_STATUS_LABELS) },
        processedAt: { type: 'string', format: 'date-time' },
        totalRows: { type: 'integer', minimum: 1 },
        acceptedRows: { type: 'integer', minimum: 0 },
        rejectedRows: { type: 'integer', minimum: 0 },
        acceptedReservations: {
          type: 'array',
          description: 'Filas efectivamente persistidas por este lote.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['rowNumber', 'reservationId'],
            properties: {
              rowNumber: { type: 'integer', minimum: 2 },
              reservationId: { type: 'string', pattern: DECIMAL_ID_PATTERN },
            },
          },
        },
        rejectedRowDetails: {
          type: 'array',
          description: 'Errores INDIVIDUALES por fila (el valor recibido nunca se devuelve).',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['rowNumber', 'reservationId', 'errors'],
            properties: {
              rowNumber: {
                type: 'integer',
                minimum: 2,
                description: 'Fila del archivo (la cabecera es la fila 1).',
              },
              reservationId: { type: ['string', 'null'] },
              errors: { type: 'array', minItems: 1, items: rowError },
            },
          },
        },
        rejectionSummary: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['code', 'message', 'rows'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              rows: { type: 'integer', minimum: 1 },
            },
          },
        },
        ignoredColumns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Columnas no contractuales: se ignoran y no se almacenan.',
        },
        predictionsGenerated: { type: 'boolean', enum: [false] },
        notice: { type: 'string' },
        actorKind: { type: 'string', enum: ['INTERNAL_SERVICE'] },
        actorUserId: { type: 'null' },
      },
    },
    requestId: { type: 'string' },
  },
} as const;

export const ImportReservationsSchema = {
  tags: ['Reservation import'],
  summary: 'Incorporar reservas desde un archivo CSV o Excel',
  description: `Recibe UN archivo (campo "file", multipart/form-data) .csv (UTF-8, separador "," o ";") o .xlsx (primera hoja; sin fórmulas, macros ni vínculos externos) con el contrato ${RESERVATION_IMPORT_CONTRACT_VERSION}. Columnas obligatorias: ${requiredColumns}. Opcionales: ${optionalColumns}. Las columnas no contractuales se ignoran. Fechas y horas en hora de Lima. Cada fila válida se incorpora en ml.app_imported_reservations (nunca en raw_flow/analytics) y queda disponible en GET /reservations, GET /reservations/{id} y POST /reservations/{id}/predictions; la importación NO genera predicciones. Filas inválidas se rechazan individualmente sin impedir las demás. Idempotente: una reserva ya incorporada o existente en la fuente nunca se duplica ni se reemplaza. 201 = lote registrado (aunque todas las filas se rechacen); 422 = error general del archivo (no se registra lote).`,
  security: [{ InternalApiKey: [] }],
  consumes: ['multipart/form-data'],
  body: {
    type: 'object',
    required: ['file'],
    properties: {
      file: {
        type: 'string',
        format: 'binary',
        description: 'Archivo .csv o .xlsx (contrato reservation_import_v1).',
      },
    },
  },
  response: {
    201: { ...responseBody, description: 'Lote procesado y registrado.' },
    401: { ...ErrorResponseSchema, description: 'Credencial x-api-key ausente o inválida.' },
    413: {
      ...ErrorResponseSchema,
      description: 'PAYLOAD_TOO_LARGE: archivo mayor al límite o más de un archivo/campo.',
    },
    415: {
      ...ErrorResponseSchema,
      description: 'UNSUPPORTED_MEDIA_TYPE: la solicitud no es multipart/form-data.',
    },
    422: {
      ...ErrorResponseSchema,
      description: `Error general del ARCHIVO (sin lote): ${Object.keys(FILE_ERROR_MESSAGES).join(', ')}.`,
    },
    503: {
      ...ErrorResponseSchema,
      description:
        'PERSISTENCE_UNAVAILABLE (almacén de la app) o SOURCE_DATA_UNAVAILABLE (fuente de referencia).',
    },
  },
} as const satisfies FastifySchema;
