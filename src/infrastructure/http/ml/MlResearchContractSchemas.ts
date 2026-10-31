import { z } from 'zod';
import { ComparisonSchema } from './MlContractSchemas.js';
import { ML_FEATURE_VERSION, ML_MODEL_KEYS } from './MlFeatureContract.js';

/**
 * Validación runtime de la superficie research v2 de depi-noshow-ml (OpenAPI
 * ml-internal-v2.openapi.json, SHA-256 840b48d6…, commit b0e11893). Igual que en v1, los campos
 * que el OpenAPI declara opcionales con default (estados, banderas operativas, legacy null) se
 * EXIGEN presentes: son los que impiden confundir una banda relativa con riesgo aprobado.
 * Objetos estrictos: un campo nuevo en Python exige revisar el contrato explícitamente.
 */
export const RESEARCH_POLICY_VERSION = 'research_risk_v1_1';
export const RESEARCH_BOUNDARY_RULE = 'LOW:p<t_low;MEDIUM:t_low<=p<t_high;HIGH:p>=t_high';
export const RESEARCH_MEANING = 'relative_score_band_not_validated_absolute_risk';
export const EXPERIMENTAL_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const EXPERIMENTAL_RISK_LABELS = {
  LOW: 'Bajo (exploratorio)',
  MEDIUM: 'Medio (exploratorio)',
  HIGH: 'Alto (exploratorio)',
} as const;
export const RESEARCH_POLICY_UNAVAILABLE_REASONS = [
  'disabled',
  'models_unavailable',
  'missing_policy',
  'hash_mismatch',
  'invalid_policy',
  'model_identity_mismatch',
  'insufficient_support',
] as const;

const RequestIdSchema = z.string().min(1).max(64);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const ShortHashSchema = z.string().regex(/^[0-9a-f]{6,64}$/);
const ModelVersionSchema = z.string().min(1).max(128);
const PolicyIdSchema = z.string().min(1).max(128);
const ThresholdSchema = z.number().gt(0).lt(1);
const WarningsSchema = z.array(z.string().min(1).max(500)).max(20);

const ExploratoryStatusFields = {
  risk_level: z.null(),
  risk_policy_status: z.literal('pending_validation'),
  validation_status: z.literal('EXPLORATORY_NOT_VALIDATED'),
  calibration_status: z.literal('not_operationally_validated'),
  operational_use_allowed: z.literal(false),
};

export const ExperimentalRiskSchema = z.strictObject({
  level: z.enum(EXPERIMENTAL_RISK_LEVELS),
  label: z.enum([
    EXPERIMENTAL_RISK_LABELS.LOW,
    EXPERIMENTAL_RISK_LABELS.MEDIUM,
    EXPERIMENTAL_RISK_LABELS.HIGH,
  ]),
  status: z.literal('RESEARCH_PROVISIONAL'),
  policy_id: PolicyIdSchema,
  policy_version: z.literal(RESEARCH_POLICY_VERSION),
  policy_hash: Sha256Schema,
  score_space: z.literal('raw_probability_no_show'),
  low_upper_threshold: ThresholdSchema,
  high_lower_threshold: ThresholdSchema,
  boundary_rule: z.literal(RESEARCH_BOUNDARY_RULE),
  meaning: z.literal(RESEARCH_MEANING),
  operational_use_allowed: z.literal(false),
  approved_by: z.null(),
  warnings: WarningsSchema,
});

export const ResearchPredictionResponseSchema = z.strictObject({
  api_version: z.literal('v2'),
  model_key: z.enum(ML_MODEL_KEYS),
  algorithm: z.enum(['random_forest', 'xgboost']),
  model_version: ModelVersionSchema,
  model_hash: ShortHashSchema,
  model_hash_sha256: Sha256Schema,
  feature_version: z.literal(ML_FEATURE_VERSION),
  probability_no_show: z.number().min(0).max(1),
  probability_no_show_percent: z.number().min(0).max(100),
  prediction_target: z.literal('NO_SHOW_CANDIDATE'),
  target_class: z.literal(1),
  experimental_risk: ExperimentalRiskSchema,
  ...ExploratoryStatusFields,
  request_id: RequestIdSchema,
});

export const ResearchCompareResponseSchema = z.strictObject({
  api_version: z.literal('v2'),
  feature_version: z.literal(ML_FEATURE_VERSION),
  results: z.tuple([ResearchPredictionResponseSchema, ResearchPredictionResponseSchema]),
  comparison: ComparisonSchema,
  ...ExploratoryStatusFields,
  request_id: RequestIdSchema,
});

export const ResearchPolicyViewSchema = z.strictObject({
  model_key: z.enum(ML_MODEL_KEYS),
  model_version: ModelVersionSchema,
  model_hash_sha256: Sha256Schema,
  feature_version: z.literal(ML_FEATURE_VERSION),
  policy_id: PolicyIdSchema,
  policy_version: z.literal(RESEARCH_POLICY_VERSION),
  policy_hash: Sha256Schema,
  low_upper_threshold: ThresholdSchema,
  high_lower_threshold: ThresholdSchema,
  boundary_rule: z.literal(RESEARCH_BOUNDARY_RULE),
  method: z.literal('score_quantiles_tertiles_exploratory'),
  meaning: z.literal(RESEARCH_MEANING),
  development_start: z.string().min(1).max(64),
  development_end_exclusive: z.string().min(1).max(64),
  label_cutoff_exclusive: z.string().min(1).max(64),
  development_rows: z.number().int().min(0),
  calibration_ece_uniform_10: z.number().min(0).max(1),
  status: z.literal('RESEARCH_PROVISIONAL'),
  operational_use_allowed: z.literal(false),
  approved_by: z.null(),
  warnings: WarningsSchema,
});

export const ResearchPolicyCatalogSchema = z.strictObject({
  api_version: z.literal('v2'),
  status: z.enum(['RESEARCH_PROVISIONAL', 'UNAVAILABLE']),
  available: z.boolean(),
  reason: z.enum(RESEARCH_POLICY_UNAVAILABLE_REASONS).nullable(),
  policies: z.array(ResearchPolicyViewSchema).max(2),
  validation_status: z.literal('EXPLORATORY_NOT_VALIDATED'),
  operational_use_allowed: z.literal(false),
  request_id: RequestIdSchema,
});
