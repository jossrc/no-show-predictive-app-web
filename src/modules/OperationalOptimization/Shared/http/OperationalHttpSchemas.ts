import { ErrorResponseSchema } from '../../../../app/http/errors/ErrorResponseSchema.js';
import { ML_MODEL_KEYS } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import { DECIMAL_ID_PATTERN } from '../../../../shared/identifiers/DecimalId.js';
import { OVERBOOKING_STATUS_LABELS } from '../../../Reservations/Shared/http/OperationalStatusHttp.js';
import { MAX_LIST_PERIOD_DAYS } from '../../../Reservations/Shared/validation/ResolveListPeriod.js';
import { OVERBOOKING_INELIGIBILITY_MESSAGES } from '../rules/OverbookingEligibility.js';

/** Ejemplos 100 % sintéticos: IDs del rango 9000000001xxxxx (inexistentes en FLOWww). */
export const SYNTHETIC_EXAMPLES = {
  reservationId: '900000000101001',
  predictionRunId: '00000000-0000-4000-8000-000000000001',
  policyHash: '1d58ce962e899b758275f7191244225e8c970cf2db9661ffcb21be9b63a4ce74',
} as const;

const dateTime = { type: 'string', format: 'date-time' } as const;
const nullableDateTime = { type: ['string', 'null'], format: 'date-time' } as const;
const modelKey = { type: 'string', enum: [...ML_MODEL_KEYS] } as const;
export const PREDICTION_RUN_ID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

export const ReasonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message'],
  properties: {
    code: { type: 'string', enum: Object.keys(OVERBOOKING_INELIGIBILITY_MESSAGES) },
    message: { type: 'string' },
  },
} as const;

const authorshipProperties = {
  actorKind: {
    type: 'string',
    enum: ['INTERNAL_SERVICE'],
    description:
      'Autoría técnica: la compuerta x-api-key identifica un servicio interno, no a la persona (login HU-21/HU-22 pendiente).',
  },
  actorUserId: { type: 'null', description: 'Siempre null hasta implementar login/RBAC.' },
} as const;

export const OverbookingAuthorizationSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'authorizationId',
    'reservationId',
    'clinicId',
    'appointmentAt',
    'status',
    'statusLabel',
    'enabledAt',
    'modelKey',
    'modelVersion',
    'predictionRunId',
    'riskBandAtAuthorization',
    'probabilityNoShowAtAuthorization',
    'researchPolicyHash',
    'researchPolicyVersion',
    'scoredAt',
    'eligibilityRuleVersion',
    'actorKind',
    'actorUserId',
  ],
  properties: {
    authorizationId: { type: 'string', pattern: DECIMAL_ID_PATTERN, examples: ['1'] },
    reservationId: {
      type: 'string',
      pattern: DECIMAL_ID_PATTERN,
      examples: [SYNTHETIC_EXAMPLES.reservationId],
    },
    clinicId: { type: 'integer' },
    appointmentAt: dateTime,
    status: { type: 'string', enum: ['ENABLED'] },
    statusLabel: { type: 'string', enum: [OVERBOOKING_STATUS_LABELS.ENABLED] },
    enabledAt: dateTime,
    modelKey,
    modelVersion: { type: 'string' },
    predictionRunId: { type: 'string', examples: [SYNTHETIC_EXAMPLES.predictionRunId] },
    riskBandAtAuthorization: {
      type: 'string',
      enum: ['HIGH'],
      description:
        'Banda EXPERIMENTAL (research v2) del modelo elegido al autorizar; no es riesgo operativo.',
    },
    probabilityNoShowAtAuthorization: { type: 'number', minimum: 0, maximum: 1 },
    researchPolicyHash: { type: 'string', examples: [SYNTHETIC_EXAMPLES.policyHash] },
    researchPolicyVersion: { type: 'string', examples: ['research_risk_v1_1'] },
    scoredAt: dateTime,
    eligibilityRuleVersion: { type: 'string', enum: ['overbooking_eligibility_v1'] },
    ...authorshipProperties,
  },
} as const;

export const EligibilitySchema = {
  type: 'object',
  additionalProperties: false,
  description:
    'Elegibilidad calculada por el BACKEND (overbooking_eligibility_v1). El FE muestra la acción solo si eligible=true y envía modelKey + predictionRunId de un candidato con eligible=true.',
  required: ['ruleVersion', 'eligible', 'reasons', 'candidates'],
  properties: {
    ruleVersion: { type: 'string', enum: ['overbooking_eligibility_v1'] },
    eligible: { type: 'boolean' },
    reasons: { type: 'array', items: ReasonSchema },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'modelKey',
          'predictionRunId',
          'probabilityNoShow',
          'scoredAt',
          'experimentalRiskLevel',
          'researchPolicyHash',
          'eligible',
          'reasons',
        ],
        properties: {
          modelKey,
          predictionRunId: { type: 'string' },
          probabilityNoShow: { type: 'number', minimum: 0, maximum: 1 },
          scoredAt: dateTime,
          experimentalRiskLevel: {
            type: ['string', 'null'],
            enum: ['LOW', 'MEDIUM', 'HIGH', null],
          },
          researchPolicyHash: { type: ['string', 'null'] },
          eligible: { type: 'boolean' },
          reasons: { type: 'array', items: ReasonSchema },
        },
      },
    },
  },
} as const;

export const ComparisonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'modelKey',
    'modelVersion',
    'probabilityNoShow',
    'scoredAt',
    'experimentalRiskLevel',
    'comparisonRuleVersion',
    'threshold',
    'predictedNoShow',
    'observedNoShow',
    'matchesPrediction',
  ],
  properties: {
    modelKey,
    modelVersion: { type: 'string' },
    probabilityNoShow: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Score persistido del run (sin redondeo); nunca el valor del request.',
    },
    scoredAt: dateTime,
    experimentalRiskLevel: { type: ['string', 'null'], enum: ['LOW', 'MEDIUM', 'HIGH', null] },
    comparisonRuleVersion: { type: 'string', enum: ['binary_outcome_threshold_v1'] },
    threshold: {
      type: 'number',
      description:
        'Umbral técnico PROVISIONAL (0.5) para contrastar un score continuo; no validado.',
    },
    predictedNoShow: { type: 'boolean' },
    observedNoShow: { type: 'boolean' },
    matchesPrediction: { type: 'boolean' },
  },
} as const;

export const AttendanceOutcomeSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'attendanceOutcomeId',
    'reservationId',
    'clinicId',
    'appointmentAt',
    'appointmentEndAt',
    'attendanceStatus',
    'observedNoShow',
    'recordedAt',
    'predictionRunId',
    'finishedRuleVersion',
    'comparisons',
    'comparisonNotice',
    'actorKind',
    'actorUserId',
  ],
  properties: {
    attendanceOutcomeId: { type: 'string', pattern: DECIMAL_ID_PATTERN },
    reservationId: { type: 'string', pattern: DECIMAL_ID_PATTERN },
    clinicId: { type: 'integer' },
    appointmentAt: dateTime,
    appointmentEndAt: nullableDateTime,
    attendanceStatus: { type: 'string', enum: ['ATTENDED', 'NO_SHOW'] },
    observedNoShow: { type: 'boolean' },
    recordedAt: dateTime,
    predictionRunId: { type: 'string' },
    finishedRuleVersion: { type: 'string', enum: ['appointment_finished_rule_v1'] },
    comparisons: {
      type: 'array',
      items: ComparisonSchema,
      description:
        'Una comparación por modelo del run (RF y XGB por separado, sin ensemble ni ganador).',
    },
    comparisonNotice: { type: 'string' },
    ...authorshipProperties,
  },
} as const;

export const SpaceRecoveryOutcomeSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'recoveryOutcomeId',
    'authorizationId',
    'reservationId',
    'clinicId',
    'appointmentAt',
    'spaceRecovered',
    'recordedAt',
    'actorKind',
    'actorUserId',
  ],
  properties: {
    recoveryOutcomeId: { type: 'string', pattern: DECIMAL_ID_PATTERN },
    authorizationId: { type: 'string', pattern: DECIMAL_ID_PATTERN },
    reservationId: { type: 'string', pattern: DECIMAL_ID_PATTERN },
    clinicId: { type: 'integer' },
    appointmentAt: dateTime,
    spaceRecovered: {
      type: 'boolean',
      description: 'true = se recuperó el espacio; false = se gestionó pero NO se recuperó.',
    },
    recordedAt: dateTime,
    ...authorshipProperties,
  },
} as const;

export const RecordListQuerySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['from', 'to'],
  properties: {
    from: {
      type: 'string',
      format: 'date',
      description: `Fecha de CITA inicial inclusiva (calendario America/Lima). Máximo ${MAX_LIST_PERIOD_DAYS} días hasta to.`,
      examples: ['2026-11-01'],
    },
    to: {
      type: 'string',
      format: 'date',
      description: 'Fecha de CITA final inclusiva (America/Lima), igual o posterior a from.',
      examples: ['2026-11-30'],
    },
    clinicId: {
      type: 'string',
      pattern: '^[1-9][0-9]{0,8}$',
      description: 'Sede; se valida su existencia. El alcance del consumidor se aplica siempre.',
    },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    cursor: {
      type: 'string',
      minLength: 1,
      maxLength: 512,
      pattern: '^[A-Za-z0-9_-]+$',
      description: 'pagination.nextCursor de la página anterior (mismos filtros).',
    },
  },
} as const;

export const PaginationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['limit', 'nextCursor'],
  properties: { limit: { type: 'integer' }, nextCursor: { type: ['string', 'null'] } },
} as const;

export const PeriodSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['from', 'to', 'timeZone', 'startInclusive', 'endExclusive'],
  properties: {
    from: { type: 'string' },
    to: { type: 'string' },
    timeZone: { type: 'string' },
    startInclusive: dateTime,
    endExclusive: dateTime,
  },
} as const;

export function listResponseSchema(items: object, description: string) {
  return {
    description,
    type: 'object',
    additionalProperties: false,
    required: ['data', 'pagination', 'period', 'requestId'],
    properties: {
      data: { type: 'array', items },
      pagination: PaginationSchema,
      period: PeriodSchema,
      requestId: { type: 'string' },
    },
  } as const;
}

export const CommonErrorResponses = {
  400: {
    ...ErrorResponseSchema,
    description:
      'REQUEST_VALIDATION_ERROR: parámetros, query o cuerpo inválidos (sin coerción de tipos en cuerpos).',
  },
  401: {
    ...ErrorResponseSchema,
    description: 'Credencial x-api-key ausente o inválida; se comprueba antes de validar o buscar.',
  },
  503: {
    ...ErrorResponseSchema,
    description:
      'PERSISTENCE_UNAVAILABLE: almacén PostgreSQL de la app no disponible; SOURCE_DATA_UNAVAILABLE: fuente de reservas no disponible.',
  },
} as const;

export const ReservationNotFoundResponse = {
  404: {
    ...ErrorResponseSchema,
    description:
      'RESERVATION_NOT_FOUND: reserva inexistente o fuera del alcance (no se revela cuál).',
  },
} as const;

export const ListQueryErrorResponses = {
  422: {
    ...ErrorResponseSchema,
    description:
      'INVALID_PERIOD, UNKNOWN_CLINIC o INVALID_CURSOR: validación semántica de la consulta.',
  },
} as const;
