import type { FastifySchema } from 'fastify';
import { ErrorResponseSchema } from '../../../../../../app/http/errors/ErrorResponseSchema.js';

const strictObject = (properties: Record<string, unknown>) =>
  ({
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  }) as const;

const policy = strictObject({
  modelKey: { type: 'string', enum: ['random_forest_full_v1', 'xgboost_full_v1'] },
  modelVersion: { type: 'string' },
  modelHashSha256: { type: 'string' },
  policyId: { type: 'string' },
  policyVersion: { type: 'string', examples: ['research_risk_v1_1'] },
  policyHash: { type: 'string' },
  lowUpperThreshold: { type: 'number', description: 'LOW si p < este límite.' },
  highLowerThreshold: { type: 'number', description: 'HIGH si p >= este límite.' },
  boundaryRule: { type: 'string' },
  method: { type: 'string', enum: ['score_quantiles_tertiles_exploratory'] },
  meaning: { type: 'string', enum: ['relative_score_band_not_validated_absolute_risk'] },
  developmentStart: { type: 'string' },
  developmentEndExclusive: { type: 'string' },
  labelCutoffExclusive: { type: 'string' },
  developmentRows: { type: 'integer' },
  calibrationEceUniform10: { type: 'number' },
  warnings: { type: 'array', items: { type: 'string' } },
  status: { type: 'string', enum: ['RESEARCH_PROVISIONAL'] },
  approvedBy: { type: 'null' },
  operationalUseAllowed: { type: 'boolean', enum: [false] },
});

export const GetResearchRiskPolicySchema = {
  tags: ['Prediction Models'],
  summary: 'Consultar la política experimental de bandas',
  description:
    'Estado de la política research v2 (research_risk_v1_1) publicada por Python: una política por modelo (RF y XGB, nunca combinadas), límites, regla de frontera, hashes y advertencias. available=true significa «política experimental disponible», NO «política comercial aprobada»: approvedRiskPolicyStatus sigue pending_validation, approvedBy=null y operationalUseAllowed=false. Las bandas son terciles relativos del score crudo, no probabilidades de inasistencia. reason: disabled, models_unavailable, missing_policy, hash_mismatch, invalid_policy, model_identity_mismatch, insufficient_support (Python), disabled_by_node_configuration o not_allowlisted (Node).',
  security: [{ InternalApiKey: [] }],
  response: {
    200: {
      description:
        'Política experimental disponible o UNAVAILABLE con su razón (nunca LOW por defecto).',
      ...strictObject({
        data: strictObject({
          nodeResearchRiskEnabled: { type: 'boolean' },
          available: { type: 'boolean' },
          status: { type: 'string', enum: ['RESEARCH_PROVISIONAL', 'UNAVAILABLE'] },
          reason: { type: ['string', 'null'] },
          classificationBasis: { type: ['string', 'null'], enum: ['RESEARCH_PROVISIONAL', null] },
          approvedRiskPolicyStatus: { type: 'string', enum: ['pending_validation', 'approved'] },
          validationStatus: { type: 'string', enum: ['EXPLORATORY_NOT_VALIDATED'] },
          operationalUseAllowed: { type: 'boolean', enum: [false] },
          labels: strictObject({
            LOW: { type: 'string' },
            MEDIUM: { type: 'string' },
            HIGH: { type: 'string' },
          }),
          notice: { type: 'string' },
          policies: { type: 'array', items: policy },
        }),
        requestId: { type: 'string' },
      }),
    },
    401: {
      ...ErrorResponseSchema,
      description: 'Credencial x-api-key ausente o inválida.',
    },
    429: { ...ErrorResponseSchema, description: 'ML_RATE_LIMITED.' },
    502: {
      ...ErrorResponseSchema,
      description: 'ML_CONTRACT_VIOLATION: catálogo v2 fuera de contrato.',
    },
    503: {
      ...ErrorResponseSchema,
      description:
        'ML_UNAVAILABLE / ML_CREDENTIAL_REJECTED / ML_NOT_CONFIGURED: servicio Python no disponible.',
    },
    504: { ...ErrorResponseSchema, description: 'ML_TIMEOUT.' },
  },
} as const satisfies FastifySchema;
