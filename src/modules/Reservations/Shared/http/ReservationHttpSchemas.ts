const nullableDateTime = { type: ['string', 'null'], format: 'date-time' } as const;

export const ReservationBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'reservationId',
    'clientId',
    'clinicId',
    'appointmentAt',
    'bookingCreatedAt',
    'reservationStatus',
    'sourceClassification',
    'hasRescheduleEvent',
    'classificationCutoffAt',
    'sourceFreshness',
  ],
  properties: {
    reservationId: { type: 'string' },
    clientId: { type: 'string' },
    clinicId: { type: 'integer' },
    appointmentAt: { type: 'string', format: 'date-time' },
    bookingCreatedAt: nullableDateTime,
    reservationStatus: { type: 'string', enum: ['SCHEDULED', 'CANCELLED', 'PAST'] },
    sourceClassification: { type: ['string', 'null'] },
    hasRescheduleEvent: { type: 'boolean' },
    classificationCutoffAt: nullableDateTime,
    sourceFreshness: { type: 'string', enum: ['CURRENT', 'STALE_CLASSIFICATION'] },
  },
} as const;

/** Banda EXPERIMENTAL compacta (research v2) para listados; null si el score no la tiene. */
export const ExperimentalRiskSummarySchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  required: ['level', 'label', 'status', 'policyId', 'policyVersion', 'policyHash'],
  properties: {
    level: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
    label: {
      type: 'string',
      enum: ['Bajo (exploratorio)', 'Medio (exploratorio)', 'Alto (exploratorio)'],
    },
    status: { type: 'string', enum: ['RESEARCH_PROVISIONAL'] },
    policyId: { type: 'string' },
    policyVersion: { type: 'string' },
    policyHash: { type: 'string' },
  },
} as const;

export const ScoreSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'modelKey',
    'modelVersion',
    'modelHash',
    'probabilityNoShow',
    'percentageNoShow',
    'scoredAt',
    'predictionRunId',
    'riskLevel',
    'experimentalRisk',
  ],
  properties: {
    modelKey: { type: 'string' },
    modelVersion: { type: 'string' },
    modelHash: { type: 'string' },
    probabilityNoShow: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Probabilidad exploratoria original del modelo, persistida sin redondear.',
    },
    percentageNoShow: {
      type: 'number',
      minimum: 0,
      maximum: 100,
      description: 'probabilityNoShow * 100; estimación exploratoria sin validación operativa.',
    },
    scoredAt: { type: 'string', format: 'date-time' },
    predictionRunId: { type: 'string' },
    riskLevel: {
      type: ['string', 'null'],
      enum: ['LOW', 'MEDIUM', 'HIGH', null],
      examples: [null],
      description:
        'Riesgo OPERATIVO: permanece null mientras la política científica de niveles esté pendiente de validación.',
    },
    experimentalRisk: {
      ...ExperimentalRiskSummarySchema,
      description:
        'Banda relativa EXPERIMENTAL de Python v2 persistida con este score (RESEARCH_PROVISIONAL); null sin política research.',
    },
  },
} as const;
