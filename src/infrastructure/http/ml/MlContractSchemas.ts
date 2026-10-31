import { z } from 'zod';
import { ML_FEATURE_VERSION, ML_MODEL_KEYS, PREDICTOR_COLUMNS } from './MlFeatureContract.js';

/**
 * Validación runtime de respuestas Python (OpenAPI ml-internal-v1, commit f2f30b5f).
 * Los campos que el OpenAPI declara opcionales con default (estados, risk_level, etc.) se
 * exigen presentes: son críticos para no confundir un score exploratorio con riesgo operativo.
 * Objetos estrictos: un campo nuevo en Python exige revisar el contrato explícitamente.
 */
const RequestIdSchema = z.string().min(1).max(64);
const ModelHashSchema = z.string().regex(/^[0-9a-f]{6,64}$/);
const ModelVersionSchema = z.string().min(1).max(128);

const ExploratoryStatusFields = {
  risk_level: z.null(),
  risk_policy_status: z.literal('pending_validation'),
  validation_status: z.literal('EXPLORATORY_NOT_VALIDATED'),
  calibration_status: z.literal('not_operationally_validated'),
  operational_use_allowed: z.literal(false),
};

export const PredictionResponseSchema = z.strictObject({
  api_version: z.literal('v1'),
  model_key: z.enum(ML_MODEL_KEYS),
  algorithm: z.enum(['random_forest', 'xgboost']),
  model_version: ModelVersionSchema,
  model_hash: ModelHashSchema,
  feature_version: z.literal(ML_FEATURE_VERSION),
  probability_no_show: z.number().min(0).max(1),
  prediction_target: z.literal('NO_SHOW_CANDIDATE'),
  target_class: z.literal(1),
  ...ExploratoryStatusFields,
  request_id: RequestIdSchema,
});

export const ComparisonSchema = z.strictObject({
  absolute_probability_difference: z.number().min(0).max(1),
  interpretation: z.literal('descriptive_only_not_model_confidence'),
  ensemble_probability: z.null(),
  selected_winner: z.null(),
});

export const CompareResponseSchema = z.strictObject({
  api_version: z.literal('v1'),
  feature_version: z.literal(ML_FEATURE_VERSION),
  results: z.tuple([PredictionResponseSchema, PredictionResponseSchema]),
  comparison: ComparisonSchema,
  ...ExploratoryStatusFields,
  request_id: RequestIdSchema,
});

export const FactorSchema = z.strictObject({
  feature_name: z.enum(PREDICTOR_COLUMNS),
  direction: z.enum(['increases_model_output', 'decreases_model_output', 'neutral']),
  contribution: z.number(),
  absolute_contribution: z.number().min(0),
});

const ExplanationCommonFields = {
  method: z.literal('tree_shap'),
  feature_perturbation: z.literal('tree_path_dependent'),
  base_value: z.number(),
  model_output_in_explanation_space: z.number(),
  reconstructed_output_in_explanation_space: z.number(),
  additivity_error: z.number().min(0),
  explained_class: z.literal(1),
  total_feature_count: z.literal(19),
  top_k: z.number().int().min(1).max(10),
  factors: z.array(FactorSchema).min(1).max(10),
  other_features_contribution: z.number(),
  explanation_scope: z.literal('local_association_not_causality'),
};

export const ProbabilityExplanationSchema = z.strictObject({
  ...ExplanationCommonFields,
  output_space: z.literal('probability'),
  output_link: z.literal('identity'),
});

export const LogOddsExplanationSchema = z.strictObject({
  ...ExplanationCommonFields,
  output_space: z.literal('log_odds'),
  output_link: z.literal('sigmoid'),
});

export const ExplanationResponseSchema = z.strictObject({
  ...PredictionResponseSchema.shape,
  explanation: z.discriminatedUnion('output_space', [
    ProbabilityExplanationSchema,
    LogOddsExplanationSchema,
  ]),
});

const BatchRootFields = {
  api_version: z.literal('v1'),
  feature_version: z.literal(ML_FEATURE_VERSION),
  count: z.number().int().min(1).max(64),
  ...ExploratoryStatusFields,
  request_id: RequestIdSchema,
};

export const BatchSingleResponseSchema = z.strictObject({
  ...BatchRootFields,
  mode: z.literal('single'),
  results: z
    .array(z.strictObject({ index: z.number().int().min(0), prediction: PredictionResponseSchema }))
    .min(1)
    .max(64),
});

export const BatchCompareResponseSchema = z.strictObject({
  ...BatchRootFields,
  mode: z.literal('compare'),
  results: z
    .array(z.strictObject({ index: z.number().int().min(0), prediction: CompareResponseSchema }))
    .min(1)
    .max(64),
});

export const BatchResponseSchema = z.discriminatedUnion('mode', [
  BatchSingleResponseSchema,
  BatchCompareResponseSchema,
]);

export const ModelDescriptorSchema = z.strictObject({
  model_key: z.enum(ML_MODEL_KEYS),
  algorithm: z.enum(['random_forest', 'xgboost']),
  model_version: ModelVersionSchema,
  model_hash: ModelHashSchema,
  experiment: z.literal('full'),
  training_mode: z.literal('exploratory'),
  validation_status: z.literal('EXPLORATORY_NOT_VALIDATED'),
  calibration_status: z.literal('not_operationally_validated'),
  operational_use_allowed: z.literal(false),
  feature_count: z.literal(19),
  predictor_columns: z.array(z.string()).length(19),
  role: z.enum(['provisional_demo_default', 'independent_comparator']),
});

export const ModelsResponseSchema = z.strictObject({
  api_version: z.literal('v1'),
  feature_version: z.literal(ML_FEATURE_VERSION),
  default_model_key: z.enum(ML_MODEL_KEYS),
  models: z.tuple([ModelDescriptorSchema, ModelDescriptorSchema]),
});

export const ReadyResponseSchema = z.strictObject({
  status: z.literal('ready'),
  models_loaded: z.tuple([z.string(), z.string()]),
  serving_status: z.literal('EXPLORATORY_NOT_VALIDATED'),
  operational_use_allowed: z.literal(false),
});

/** Sobre de error Python: se lee de forma tolerante solo para mapear el código. */
export const MlErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().max(64),
    message: z.string().max(500),
    details: z.array(z.object({ field: z.string().max(200), reason: z.string().max(100) })).max(20),
  }),
  request_id: z.string().max(64),
});
