import {
  ReservationBodySchema,
  ScoreSummarySchema,
} from '../../../Reservations/Shared/http/ReservationHttpSchemas.js';

export const NotScorableReasonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message'],
  properties: { code: { type: 'string' }, message: { type: 'string' } },
} as const;

const nullableLevel = {
  type: ['string', 'null'],
  enum: ['LOW', 'MEDIUM', 'HIGH', null],
  examples: [null],
  description:
    'En Sprint 01 permanece null: no existe una política científicamente aprobada de niveles de riesgo.',
} as const;

export const ModelResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'modelKey',
    'algorithm',
    'modelVersion',
    'modelHash',
    'probabilityNoShow',
    'percentageNoShow',
    'target',
    'validationStatus',
    'calibrationStatus',
    'operationalUseAllowed',
    'riskLevel',
    'predictionAt',
    'scoredAt',
    'predictionRunId',
  ],
  properties: {
    modelKey: { type: 'string' },
    algorithm: { type: 'string', enum: ['random_forest', 'xgboost'] },
    modelVersion: { type: 'string' },
    modelHash: { type: 'string' },
    probabilityNoShow: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Score exploratorio del modelo independiente, persistido sin redondear.',
    },
    percentageNoShow: {
      type: 'number',
      minimum: 0,
      maximum: 100,
      description: 'probabilityNoShow * 100; representación porcentual sin validación operativa.',
    },
    target: { type: 'string', enum: ['NO_SHOW_CANDIDATE'] },
    validationStatus: { type: 'string' },
    calibrationStatus: { type: 'string' },
    operationalUseAllowed: { type: 'boolean', enum: [false] },
    riskLevel: nullableLevel,
    predictionAt: { type: 'string', format: 'date-time' },
    scoredAt: { type: 'string', format: 'date-time' },
    predictionRunId: { type: 'string' },
  },
} as const;

export const RiskAssessmentBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'reservationId',
    'status',
    'reasons',
    'sourceStatus',
    'snapshot',
    'models',
    'comparison',
    'riskLevel',
    'riskPolicyStatus',
    'riskPolicyVersion',
    'classificationUnavailable',
    'validationStatus',
    'operationalUseAllowed',
    'message',
  ],
  properties: {
    reservationId: { type: 'string' },
    status: {
      type: 'string',
      enum: ['AVAILABLE_EXPLORATORY', 'NOT_SCORED', 'NOT_SCORABLE'],
      description:
        'NOT_SCORED indica ausencia de scores; NOT_SCORABLE indica falta de evidencia temporal suficiente; AVAILABLE_EXPLORATORY indica estimaciones guardadas.',
    },
    reasons: { type: 'array', items: NotScorableReasonSchema },
    sourceStatus: { type: 'string', enum: ['READ_ONLY_EXISTING_SCHEDULE', 'SYNTHETIC_DEMO_ONLY'] },
    sourceFreshness: { type: 'string', enum: ['CURRENT', 'STALE_CLASSIFICATION'] },
    snapshot: {
      description:
        'Snapshot temporalmente válido al crear la reserva; null cuando no está disponible.',
      type: ['object', 'null'],
      additionalProperties: false,
      required: [
        'snapshotType',
        'predictionAt',
        'appointmentAt',
        'featureVersion',
        'builderVersion',
        'evidenceSource',
        'snapshotHash',
      ],
      properties: {
        snapshotType: { type: 'string', enum: ['booking_creation'] },
        predictionAt: { type: 'string', format: 'date-time' },
        appointmentAt: { type: 'string', format: 'date-time' },
        featureVersion: { type: 'string' },
        builderVersion: { type: 'string' },
        evidenceSource: {
          type: 'string',
          enum: ['VERIFIED_BOOKING_SNAPSHOT', 'SYNTHETIC_DEMO_ONLY'],
        },
        snapshotHash: { type: 'string' },
      },
    },
    models: { type: 'array', items: ModelResultSchema },
    comparison: {
      description:
        'Comparación descriptiva de RF y XGBoost independientes; ensembleProbability y selectedWinner permanecen null.',
      type: ['object', 'null'],
      additionalProperties: false,
      required: [
        'absoluteProbabilityDifference',
        'absolutePercentagePointDifference',
        'interpretation',
        'ensembleProbability',
        'selectedWinner',
      ],
      properties: {
        absoluteProbabilityDifference: { type: 'number', minimum: 0, maximum: 1 },
        absolutePercentagePointDifference: { type: 'number', minimum: 0, maximum: 100 },
        interpretation: { type: 'string', enum: ['descriptive_only_not_model_confidence'] },
        ensembleProbability: { type: 'null' },
        selectedWinner: { type: 'null' },
      },
    },
    riskLevel: nullableLevel,
    riskPolicyStatus: { type: 'string', enum: ['pending_validation', 'approved'] },
    riskPolicyVersion: { type: ['string', 'null'] },
    classificationUnavailable: { type: 'boolean' },
    validationStatus: { type: 'string', enum: ['EXPLORATORY_NOT_VALIDATED'] },
    operationalUseAllowed: { type: 'boolean', enum: [false] },
    message: { type: 'string' },
  },
} as const;

export const ListItemSchema = {
  ...ReservationBodySchema,
  required: [...ReservationBodySchema.required, 'risk'],
  properties: {
    ...ReservationBodySchema.properties,
    risk: {
      type: 'object',
      additionalProperties: false,
      required: [
        'predictionAvailability',
        'notScorableReasons',
        'riskLevel',
        'riskPolicyStatus',
        'classificationUnavailable',
        'validationStatus',
        'probabilities',
      ],
      properties: {
        predictionAvailability: {
          type: 'string',
          enum: ['AVAILABLE_EXPLORATORY', 'NOT_SCORED', 'NOT_SCORABLE'],
        },
        notScorableReasons: { type: 'array', items: NotScorableReasonSchema },
        riskLevel: nullableLevel,
        riskPolicyStatus: { type: 'string', enum: ['pending_validation', 'approved'] },
        classificationUnavailable: { type: 'boolean' },
        validationStatus: { type: 'string', enum: ['EXPLORATORY_NOT_VALIDATED'] },
        probabilities: { type: 'array', items: ScoreSummarySchema },
      },
    },
  },
} as const;
