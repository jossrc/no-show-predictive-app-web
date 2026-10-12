import {
  ExperimentalRiskSummarySchema,
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
    'Riesgo OPERATIVO: permanece null porque no existe una política científica/comercial aprobada. No confundir con experimentalRisk.level.',
} as const;

/** Banda EXPERIMENTAL completa (política research v2 de Python), tal como se persistió. */
export const ExperimentalRiskSchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  description:
    'Banda relativa EXPERIMENTAL (terciles del score crudo, research_risk_v1_1). No es probabilidad de inasistencia ni riesgo operativo; operationalUseAllowed=false y approvedBy=null. null si el score se obtuvo sin política research. Ejemplo: respuesta real de Python v2 para la entrada sintética examples/prediction_compare.json (RF p=0.6976400433344135).',
  examples: [
    {
      level: 'HIGH',
      label: 'Alto (exploratorio)',
      status: 'RESEARCH_PROVISIONAL',
      classificationBasis: 'RESEARCH_PROVISIONAL',
      policyId: 'random_forest_full_v1_tertiles_202604_202605',
      policyVersion: 'research_risk_v1_1',
      policyHash: '1d58ce962e899b758275f7191244225e8c970cf2db9661ffcb21be9b63a4ce74',
      lowUpperThreshold: 0.302192334412,
      highLowerThreshold: 0.460052607619,
      boundaryRule: 'LOW:p<t_low;MEDIUM:t_low<=p<t_high;HIGH:p>=t_high',
      meaning: 'relative_score_band_not_validated_absolute_risk',
      scoreSpace: 'raw_probability_no_show',
      warnings: [
        'Relative raw-score bands, not validated absolute risks or cancellation probabilities.',
      ],
      approvedBy: null,
      operationalUseAllowed: false,
    },
  ],
  required: [
    'level',
    'label',
    'status',
    'classificationBasis',
    'policyId',
    'policyVersion',
    'policyHash',
    'lowUpperThreshold',
    'highLowerThreshold',
    'boundaryRule',
    'meaning',
    'scoreSpace',
    'warnings',
    'approvedBy',
    'operationalUseAllowed',
  ],
  properties: {
    level: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
    label: {
      type: 'string',
      enum: ['Bajo (exploratorio)', 'Medio (exploratorio)', 'Alto (exploratorio)'],
    },
    status: { type: 'string', enum: ['RESEARCH_PROVISIONAL'] },
    classificationBasis: { type: 'string', enum: ['RESEARCH_PROVISIONAL'] },
    policyId: { type: 'string' },
    policyVersion: { type: 'string', examples: ['research_risk_v1_1'] },
    policyHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    lowUpperThreshold: {
      type: 'number',
      exclusiveMinimum: 0,
      exclusiveMaximum: 1,
      description: 'LOW si p < lowUpperThreshold (límite publicado por Python).',
    },
    highLowerThreshold: {
      type: 'number',
      exclusiveMinimum: 0,
      exclusiveMaximum: 1,
      description:
        'HIGH si p >= highLowerThreshold; MEDIUM entre ambos (inclusivo a la izquierda).',
    },
    boundaryRule: { type: 'string' },
    meaning: { type: 'string', enum: ['relative_score_band_not_validated_absolute_risk'] },
    scoreSpace: { type: 'string', enum: ['raw_probability_no_show'] },
    warnings: { type: 'array', items: { type: 'string' } },
    approvedBy: { type: 'null' },
    operationalUseAllowed: { type: 'boolean', enum: [false] },
  },
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
    'experimentalRisk',
    'experimentalRiskUnavailableReason',
    'modelHashSha256',
    'scoringApiVersion',
    'predictionAt',
    'scoredAt',
    'predictionRunId',
  ],
  properties: {
    modelKey: { type: 'string' },
    algorithm: { type: 'string', enum: ['random_forest', 'xgboost'] },
    modelVersion: { type: 'string' },
    modelHash: { type: 'string' },
    modelHashSha256: {
      type: ['string', 'null'],
      description: 'SHA-256 completo del artefacto (scores v2); null en scores v1 heredados.',
    },
    scoringApiVersion: {
      type: 'string',
      enum: ['v1', 'v2'],
      description: 'v2 = score con política research (banda experimental); v1 = sin banda.',
    },
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
    experimentalRisk: ExperimentalRiskSchema,
    experimentalRiskUnavailableReason: {
      type: ['string', 'null'],
      enum: ['SCORED_WITHOUT_RESEARCH_POLICY', null],
    },
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
    'operationalClassificationUnavailable',
    'experimentalClassificationUnavailable',
    'classificationBasis',
    'experimentalRiskNotice',
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
    classificationUnavailable: {
      type: 'boolean',
      description:
        'true solo si no hay clasificación operativa NI banda experimental. Ver los dos campos específicos.',
    },
    operationalClassificationUnavailable: {
      type: 'boolean',
      description: 'Riesgo operativo aprobado no disponible (política pending_validation).',
    },
    experimentalClassificationUnavailable: {
      type: 'boolean',
      description: 'Ningún modelo trae banda experimental research v2 persistida.',
    },
    classificationBasis: { type: ['string', 'null'], enum: ['RESEARCH_PROVISIONAL', null] },
    experimentalRiskNotice: { type: ['string', 'null'] },
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
        'operationalClassificationUnavailable',
        'experimentalClassificationUnavailable',
        'experimentalRisk',
        'experimentalPolicyCurrent',
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
        operationalClassificationUnavailable: { type: 'boolean' },
        experimentalClassificationUnavailable: {
          type: 'boolean',
          description:
            'El modelo elegido (modelKey) no tiene banda experimental para esta reserva.',
        },
        experimentalRisk: {
          ...ExperimentalRiskSummarySchema,
          description:
            'Banda EXPERIMENTAL del modelo elegido (modelKey) según su último score; null si no existe. No es riesgo operativo.',
        },
        experimentalPolicyCurrent: {
          type: 'boolean',
          description:
            'true si la banda pertenece a la política vigente del listado (experimentalRiskPolicy); false si es de otra versión o no hay banda.',
        },
        validationStatus: { type: 'string', enum: ['EXPLORATORY_NOT_VALIDATED'] },
        probabilities: { type: 'array', items: ScoreSummarySchema },
      },
    },
  },
} as const;
