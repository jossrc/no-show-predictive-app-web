import { ErrorResponseSchema } from '../../../../app/http/errors/ErrorResponseSchema.js';
import {
  DEFAULT_ML_MODEL_KEY,
  ML_MODEL_KEYS,
} from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import { DECIMAL_ID_PATTERN } from '../../../../shared/identifiers/DecimalId.js';
import { ScoreSummarySchema } from '../../../Reservations/Shared/http/ReservationHttpSchemas.js';
import { RESERVATION_ORIGINS } from '../../../Reservations/Shared/models/Reservation.js';
import { RETENTION_INELIGIBILITY_MESSAGES } from '../rules/RetentionEligibility.js';
import { RETENTION_STATUSES, RETENTION_STATUS_LABELS } from '../rules/RetentionStatus.js';
import { RETENTION_WINDOW_HOURS } from '../rules/RetentionWindow.js';

const dateTime = { type: 'string', format: 'date-time' } as const;
const nullableDateTime = { type: ['string', 'null'], format: 'date-time' } as const;

/** Filtros comunes del listado y la exportación (validación estricta de enumeraciones). */
export const PriorityClientFilterProperties = {
  modelKey: {
    type: 'string',
    enum: [...ML_MODEL_KEYS],
    default: DEFAULT_ML_MODEL_KEY,
    description:
      'Modelo cuya ÚLTIMA estimación persistida se evalúa (RF y XGB por separado; sin ensemble ni selección automática).',
  },
  clinicId: {
    type: 'string',
    pattern: '^[1-9][0-9]{0,8}$',
    description:
      'Sede de atención; se valida su existencia. El alcance del consumidor se aplica siempre.',
  },
  retentionStatus: {
    type: 'string',
    enum: [...RETENTION_STATUSES],
    description: 'PENDING = sin acción registrada; CAMPAIGN_SENT = acción de retención registrada.',
  },
  sort: {
    type: 'string',
    enum: ['appointmentAt', 'probabilityNoShow'],
    default: 'appointmentAt',
    description:
      'appointmentAt = cronológico; probabilityNoShow = score exploratorio del modelo elegido (no es priorización operativa aprobada).',
  },
  direction: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
} as const;

export const PriorityClientItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'clientId',
    'reservationId',
    'clinicId',
    'appointmentAt',
    'reservationStatus',
    'origin',
    'importBatchId',
    'prediction',
    'retention',
  ],
  properties: {
    clientId: { type: 'string', pattern: DECIMAL_ID_PATTERN },
    reservationId: { type: 'string', pattern: DECIMAL_ID_PATTERN },
    clinicId: { type: 'integer' },
    appointmentAt: dateTime,
    reservationStatus: { type: 'string', enum: ['SCHEDULED'] },
    origin: { type: 'string', enum: [...RESERVATION_ORIGINS] },
    importBatchId: { type: ['string', 'null'] },
    prediction: {
      ...ScoreSummarySchema,
      description:
        'Estimación seleccionada (último score del modelo elegido) con su trazabilidad: versión, hash, run y banda experimental HIGH de la política vigente. riskLevel operativo permanece null.',
    },
    retention: {
      type: 'object',
      additionalProperties: false,
      required: [
        'status',
        'statusLabel',
        'contactId',
        'contactedAt',
        'contactModelKey',
        'contactPredictionRunId',
      ],
      properties: {
        status: { type: 'string', enum: [...RETENTION_STATUSES] },
        statusLabel: { type: 'string', enum: Object.values(RETENTION_STATUS_LABELS) },
        contactId: { type: ['string', 'null'] },
        contactedAt: nullableDateTime,
        contactModelKey: { type: ['string', 'null'] },
        contactPredictionRunId: { type: ['string', 'null'] },
      },
    },
  },
} as const;

export const RetentionQueryContextProperties = {
  window: {
    type: 'object',
    additionalProperties: false,
    description: `Ventana MÓVIL de ${RETENTION_WINDOW_HOURS} h desde el instante de consulta: (startExclusive, endInclusive].`,
    required: ['ruleVersion', 'hours', 'startExclusive', 'endInclusive', 'timeZone'],
    properties: {
      ruleVersion: { type: 'string', enum: ['retention_priority_v1'] },
      hours: { type: 'integer', enum: [RETENTION_WINDOW_HOURS] },
      startExclusive: dateTime,
      endInclusive: dateTime,
      timeZone: { type: 'string' },
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
      semantics: { type: 'string', enum: ['CHRONOLOGICAL', 'EXPLORATORY_SCORE_ORDER'] },
    },
  },
  filters: {
    type: 'object',
    additionalProperties: false,
    required: ['clinicId', 'retentionStatus'],
    properties: {
      clinicId: { type: ['integer', 'null'] },
      retentionStatus: { type: ['string', 'null'], enum: [...RETENTION_STATUSES, null] },
    },
  },
  experimentalClassificationUnavailable: {
    type: 'boolean',
    description:
      'true si el modelo no tiene política research vigente en el almacén: el listado se devuelve vacío (sin clasificar con umbrales propios).',
  },
  experimentalRiskPolicy: {
    type: ['object', 'null'],
    additionalProperties: false,
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
} as const;

export const RetentionContactSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'contactId',
    'reservationId',
    'clientId',
    'clinicId',
    'appointmentAt',
    'retentionStatus',
    'retentionStatusLabel',
    'contactedAt',
    'modelKey',
    'modelVersion',
    'predictionRunId',
    'riskBandAtContact',
    'probabilityNoShowAtContact',
    'researchPolicyHash',
    'researchPolicyVersion',
    'scoredAt',
    'eligibilityRuleVersion',
    'communicationSent',
    'actorKind',
    'actorUserId',
  ],
  properties: {
    contactId: { type: 'string', pattern: DECIMAL_ID_PATTERN },
    reservationId: { type: 'string', pattern: DECIMAL_ID_PATTERN },
    clientId: { type: 'string', pattern: DECIMAL_ID_PATTERN },
    clinicId: { type: 'integer' },
    appointmentAt: dateTime,
    retentionStatus: { type: 'string', enum: ['CAMPAIGN_SENT'] },
    retentionStatusLabel: { type: 'string', enum: [RETENTION_STATUS_LABELS.CAMPAIGN_SENT] },
    contactedAt: {
      ...dateTime,
      description: 'Hora del servidor al registrar (nunca del cliente).',
    },
    modelKey: { type: 'string', enum: [...ML_MODEL_KEYS] },
    modelVersion: { type: 'string' },
    predictionRunId: { type: 'string' },
    riskBandAtContact: { type: 'string', enum: ['HIGH'] },
    probabilityNoShowAtContact: { type: 'number', minimum: 0, maximum: 1 },
    researchPolicyHash: { type: 'string' },
    researchPolicyVersion: { type: 'string' },
    scoredAt: dateTime,
    eligibilityRuleVersion: { type: 'string', enum: ['retention_priority_v1'] },
    communicationSent: {
      type: 'boolean',
      enum: [false],
      description:
        'El sistema solo REGISTRA la acción: no envía mensajes, correos, SMS ni WhatsApp.',
    },
    actorKind: { type: 'string', enum: ['INTERNAL_SERVICE'] },
    actorUserId: { type: 'null', description: 'Siempre null hasta implementar login/RBAC.' },
  },
} as const;

export const RetentionQueryErrorResponses = {
  400: { ...ErrorResponseSchema, description: 'REQUEST_VALIDATION_ERROR: filtros inválidos.' },
  401: { ...ErrorResponseSchema, description: 'Credencial x-api-key ausente o inválida.' },
  422: {
    ...ErrorResponseSchema,
    description: 'UNKNOWN_CLINIC, INVALID_CURSOR o RANKING_CANDIDATES_EXCEEDED.',
  },
  503: {
    ...ErrorResponseSchema,
    description: 'PERSISTENCE_UNAVAILABLE o SOURCE_DATA_UNAVAILABLE.',
  },
} as const;

export const RETENTION_INELIGIBILITY_CODES = Object.keys(RETENTION_INELIGIBILITY_MESSAGES);
