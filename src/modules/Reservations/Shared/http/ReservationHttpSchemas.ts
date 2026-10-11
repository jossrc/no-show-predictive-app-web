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
  ],
  properties: {
    modelKey: { type: 'string' },
    modelVersion: { type: 'string' },
    modelHash: { type: 'string' },
    probabilityNoShow: { type: 'number', minimum: 0, maximum: 1 },
    percentageNoShow: { type: 'number', minimum: 0, maximum: 100 },
    scoredAt: { type: 'string', format: 'date-time' },
    predictionRunId: { type: 'string' },
    riskLevel: { type: ['string', 'null'], enum: ['LOW', 'MEDIUM', 'HIGH', null] },
  },
} as const;
