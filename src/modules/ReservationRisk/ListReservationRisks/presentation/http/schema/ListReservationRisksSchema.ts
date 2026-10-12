import type { FastifySchema } from 'fastify';
import { ErrorResponseSchema } from '../../../../../../app/http/errors/ErrorResponseSchema.js';
import {
  DEFAULT_ML_MODEL_KEY,
  ML_MODEL_KEYS,
} from '../../../../../../infrastructure/http/ml/MlFeatureContract.js';
import { LISTABLE_RESERVATION_STATUSES } from '../../../../../Reservations/Shared/models/ReservationStatus.js';
import { ListItemSchema } from '../../../../Shared/http/RiskHttpSchemas.js';
import { EXPERIMENTAL_RISK_LEVELS } from '../../../../Shared/models/ExperimentalRisk.js';
import { RISK_LEVELS } from '../../../../Shared/policy/RiskLevelPolicy.js';

export const ListReservationRisksSchema = {
  tags: ['Reservations'],
  summary: 'Listar reservas y scores exploratorios',
  description:
    'Consulta reservas por fechas del calendario America/Lima (fuente PostgreSQL de solo lectura) con los scores del almacén predictivo local, paginación keyset y cursor opaco. Ordenar por probabilityNoShow es un orden por score exploratorio, no una política operativa aprobada. Los modelos son independientes, sin ensemble ni ganador automático. Riesgo OPERATIVO: filtrar u ordenar por riskLevel devuelve 409 RISK_POLICY_UNAVAILABLE mientras no exista una política aprobada. Banda EXPERIMENTAL (research_risk_v1_1 de Python v2): experimentalRiskLevel=LOW|MEDIUM|HIGH filtra y sort=experimentalRisk ordena según el modelo elegido (modelKey) y la política vigente indicada en experimentalRiskPolicy; nunca se combinan RF y XGB. Las bandas son terciles relativos del score, no probabilidades ni autorización de acciones (operationalUseAllowed=false).',
  security: [{ InternalApiKey: [] }],
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['from', 'to'],
    properties: {
      from: {
        type: 'string',
        format: 'date',
        description:
          'Fecha inicial inclusiva del calendario America/Lima. Diferencia máxima entre from y to: 92 días. Ejemplo sintético.',
        examples: ['2026-11-01'],
      },
      to: {
        type: 'string',
        format: 'date',
        description:
          'Fecha final inclusiva del calendario America/Lima, igual o posterior a from. Diferencia máxima: 92 días. Ejemplo sintético.',
        examples: ['2026-11-30'],
      },
      status: {
        type: 'string',
        enum: [...LISTABLE_RESERVATION_STATUSES],
        default: 'SCHEDULED',
        description: 'Estado visible de la reserva según su clasificación actual.',
      },
      clinicId: {
        type: 'string',
        pattern: '^[1-9][0-9]{0,8}$',
        description: 'Identificador de clínica; se valida su existencia y alcance de acceso.',
      },
      sort: {
        type: 'string',
        enum: ['appointmentAt', 'probabilityNoShow', 'riskLevel', 'experimentalRisk'],
        default: 'appointmentAt',
        description:
          'appointmentAt ordena por fecha de cita; probabilityNoShow por score exploratorio del modelo elegido (NULLS LAST), sin priorización operativa aprobada; experimentalRisk por banda experimental del modelo elegido bajo la política vigente (dentro de una política equivale al orden por score; las reservas sin banda de esa política van al final). riskLevel (operativo) está bloqueado con RISK_POLICY_UNAVAILABLE.',
      },
      direction: {
        type: 'string',
        enum: ['asc', 'desc'],
        default: 'asc',
        description: 'Dirección del orden seleccionado.',
      },
      modelKey: {
        type: 'string',
        enum: [...ML_MODEL_KEYS],
        default: DEFAULT_ML_MODEL_KEY,
        description: 'Algoritmo utilizado para consultar u ordenar las estimaciones persistidas.',
      },
      riskLevel: {
        type: 'string',
        enum: [...RISK_LEVELS],
        description:
          'Riesgo OPERATIVO, temporalmente bloqueado: LOW, MEDIUM y HIGH no tienen política científicamente aprobada. Devuelve 409 RISK_POLICY_UNAVAILABLE. Para la banda experimental use experimentalRiskLevel.',
      },
      experimentalRiskLevel: {
        type: 'string',
        enum: [...EXPERIMENTAL_RISK_LEVELS],
        description:
          'Filtro por banda EXPERIMENTAL (Bajo/Medio/Alto exploratorio) del modelo elegido (modelKey) según su último score bajo la política vigente. Sin scores clasificados devuelve lista vacía con experimentalRiskPolicy=null (no 409).',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        default: 25,
        description: 'Número máximo de reservas por página.',
      },
      cursor: {
        type: 'string',
        minLength: 1,
        maxLength: 512,
        pattern: '^[A-Za-z0-9_-]+$',
        description:
          'Cursor opaco de paginación keyset recibido en pagination.nextCursor; conservar filtros y orden entre páginas.',
      },
    },
  },
  response: {
    200: {
      description: 'Reservas accesibles, scores persistidos y cursor de la siguiente página.',
      type: 'object',
      additionalProperties: false,
      required: [
        'data',
        'pagination',
        'period',
        'sort',
        'riskPolicyStatus',
        'classificationUnavailable',
        'operationalClassificationUnavailable',
        'experimentalClassificationUnavailable',
        'experimentalRiskPolicy',
        'sourceStatus',
        'predictiveStoreAvailable',
        'requestId',
      ],
      properties: {
        data: { type: 'array', items: ListItemSchema },
        pagination: {
          type: 'object',
          additionalProperties: false,
          required: ['limit', 'nextCursor'],
          properties: { limit: { type: 'integer' }, nextCursor: { type: ['string', 'null'] } },
        },
        period: {
          type: 'object',
          additionalProperties: false,
          required: ['from', 'to', 'timeZone', 'startInclusive', 'endExclusive'],
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            timeZone: { type: 'string' },
            startInclusive: { type: 'string', format: 'date-time' },
            endExclusive: { type: 'string', format: 'date-time' },
          },
        },
        sort: {
          type: 'object',
          additionalProperties: false,
          required: ['field', 'direction', 'modelKey', 'semantics'],
          properties: {
            field: { type: 'string' },
            direction: { type: 'string' },
            modelKey: { type: 'string' },
            semantics: { type: 'string' },
          },
        },
        riskPolicyStatus: { type: 'string' },
        classificationUnavailable: { type: 'boolean' },
        operationalClassificationUnavailable: { type: 'boolean' },
        experimentalClassificationUnavailable: {
          type: 'boolean',
          description: 'No hay scores v2 con banda experimental del modelo elegido en el almacén.',
        },
        experimentalRiskPolicy: {
          type: ['object', 'null'],
          additionalProperties: false,
          description:
            'Política research usada para filtrar/ordenar por banda experimental (la del score v2 más reciente del modelo elegido). Va firmada en el cursor.',
          required: [
            'modelKey',
            'policyId',
            'policyVersion',
            'policyHash',
            'status',
            'classificationBasis',
            'operationalUseAllowed',
            'notice',
          ],
          properties: {
            modelKey: { type: 'string' },
            policyId: { type: 'string' },
            policyVersion: { type: 'string' },
            policyHash: { type: 'string' },
            status: { type: 'string', enum: ['RESEARCH_PROVISIONAL'] },
            classificationBasis: { type: 'string', enum: ['RESEARCH_PROVISIONAL'] },
            operationalUseAllowed: { type: 'boolean', enum: [false] },
            notice: { type: 'string' },
          },
        },
        sourceStatus: { type: 'string' },
        predictiveStoreAvailable: { type: 'boolean' },
        requestId: { type: 'string' },
      },
    },
    400: {
      ...ErrorResponseSchema,
      description: 'Solicitud inválida: REQUEST_VALIDATION_ERROR en parámetros, query o cuerpo.',
    },
    401: {
      ...ErrorResponseSchema,
      description:
        'Credencial x-api-key ausente o inválida; se comprueba antes de validar la solicitud.',
    },
    409: {
      ...ErrorResponseSchema,
      description:
        'RISK_POLICY_UNAVAILABLE: filtro o clasificación por nivel de riesgo bloqueado hasta aprobar la política.',
    },
    422: {
      ...ErrorResponseSchema,
      description:
        'INVALID_PERIOD, UNKNOWN_CLINIC, INVALID_CURSOR o RANKING_CANDIDATES_EXCEEDED: validación semántica de la consulta.',
    },
    503: {
      ...ErrorResponseSchema,
      description:
        'SOURCE_DATA_UNAVAILABLE: fuente de reservas no disponible; PERSISTENCE_UNAVAILABLE: almacén local no disponible.',
    },
  },
} as const satisfies FastifySchema;
