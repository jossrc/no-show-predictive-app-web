import type { z } from 'zod';
import {
  BatchResponseSchema,
  CompareResponseSchema,
  ExplanationResponseSchema,
  ModelsResponseSchema,
  PredictionResponseSchema,
  ReadyResponseSchema,
} from './MlContractSchemas.js';
import type {
  MlBatchResponse,
  MlCompareResponse,
  MlExplanationResponse,
  MlModelsResponse,
  MlPredictionResponse,
  MlReadyResponse,
} from './MlContractTypes.js';
import {
  ML_ALGORITHM_BY_MODEL_KEY,
  PREDICTOR_COLUMNS,
  type MlModelKey,
} from './MlFeatureContract.js';
import type { MlOperation } from './MlHttpErrorMapper.js';
import { MlContractViolationException } from './errors/MlContractViolationException.js';

/** Tolerancias documentadas por depi-noshow-ml (docs/api_ml.md, sección explicación local). */
export const SHAP_TOLERANCES = {
  rfAdditivity: 1e-7,
  xgbAdditivity: 1e-5,
  reconstructionSum: 1e-6,
  rfOutputVsProbability: 1e-9,
  xgbSigmoidVsProbability: 1e-6,
  comparisonDifference: 1e-9,
  absoluteContribution: 1e-12,
} as const;

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, operation: MlOperation): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new MlContractViolationException({
      operation,
      issuePaths: result.error.issues.map((issue) => issue.path.join('.') || '(root)'),
    });
  }
  return result.data;
}

function violation(operation: MlOperation, ...issuePaths: string[]): MlContractViolationException {
  return new MlContractViolationException({ operation, issuePaths });
}

function assertAlgorithmMatchesKey(
  score: MlPredictionResponse,
  operation: MlOperation,
  path: string,
): void {
  if (ML_ALGORITHM_BY_MODEL_KEY[score.model_key] !== score.algorithm) {
    throw violation(operation, `${path}.algorithm`);
  }
}

export function validatePredictionResponse(
  data: unknown,
  expectedModelKey: MlModelKey,
  operation: MlOperation = 'predict',
): MlPredictionResponse {
  const score = parseOrThrow(PredictionResponseSchema, data, operation);
  assertAlgorithmMatchesKey(score, operation, 'response');
  if (score.model_key !== expectedModelKey) {
    // Sin sustitución silenciosa de modelo.
    throw violation(operation, 'model_key');
  }
  return score;
}

export function validateCompareResponse(
  data: unknown,
  operation: MlOperation = 'compare',
): MlCompareResponse {
  const response = parseOrThrow(CompareResponseSchema, data, operation);
  const [first, second] = response.results;

  if (first.model_key !== 'random_forest_full_v1' || second.model_key !== 'xgboost_full_v1') {
    throw violation(operation, 'results.model_key');
  }
  assertAlgorithmMatchesKey(first, operation, 'results.0');
  assertAlgorithmMatchesKey(second, operation, 'results.1');

  const expectedDifference = Math.abs(first.probability_no_show - second.probability_no_show);
  if (
    Math.abs(response.comparison.absolute_probability_difference - expectedDifference) >
    SHAP_TOLERANCES.comparisonDifference
  ) {
    throw violation(operation, 'comparison.absolute_probability_difference');
  }

  return response;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function directionFor(contribution: number): string {
  if (contribution > 0) return 'increases_model_output';
  if (contribution < 0) return 'decreases_model_output';
  return 'neutral';
}

export function validateExplanationResponse(
  data: unknown,
  expected: { modelKey: MlModelKey; topK: number },
): MlExplanationResponse {
  const operation: MlOperation = 'explain';
  const response = parseOrThrow(ExplanationResponseSchema, data, operation);
  assertAlgorithmMatchesKey(response, operation, 'response');

  if (response.model_key !== expected.modelKey) throw violation(operation, 'model_key');

  const explanation = response.explanation;
  const isRandomForest = response.algorithm === 'random_forest';

  if (isRandomForest !== (explanation.output_space === 'probability')) {
    throw violation(operation, 'explanation.output_space');
  }
  if (explanation.top_k !== expected.topK || explanation.factors.length > expected.topK) {
    throw violation(operation, 'explanation.top_k');
  }

  const names = new Set<string>();
  let previousAbsolute = Number.POSITIVE_INFINITY;
  let factorSum = 0;

  for (const [index, factor] of explanation.factors.entries()) {
    if (names.has(factor.feature_name)) throw violation(operation, `explanation.factors.${index}`);
    names.add(factor.feature_name);

    if (
      Math.abs(factor.absolute_contribution - Math.abs(factor.contribution)) >
      SHAP_TOLERANCES.absoluteContribution
    ) {
      throw violation(operation, `explanation.factors.${index}.absolute_contribution`);
    }
    if (factor.direction !== directionFor(factor.contribution)) {
      throw violation(operation, `explanation.factors.${index}.direction`);
    }
    if (factor.absolute_contribution > previousAbsolute) {
      throw violation(operation, `explanation.factors.${index}`);
    }
    previousAbsolute = factor.absolute_contribution;
    factorSum += factor.contribution;
  }

  const reconstructed =
    explanation.base_value + factorSum + explanation.other_features_contribution;
  if (
    Math.abs(reconstructed - explanation.reconstructed_output_in_explanation_space) >
    SHAP_TOLERANCES.reconstructionSum
  ) {
    throw violation(operation, 'explanation.reconstructed_output_in_explanation_space');
  }

  const additivityTolerance = isRandomForest
    ? SHAP_TOLERANCES.rfAdditivity
    : SHAP_TOLERANCES.xgbAdditivity;
  if (explanation.additivity_error > additivityTolerance) {
    throw violation(operation, 'explanation.additivity_error');
  }

  const outputAsProbability = isRandomForest
    ? explanation.model_output_in_explanation_space
    : sigmoid(explanation.model_output_in_explanation_space);
  const probabilityTolerance = isRandomForest
    ? SHAP_TOLERANCES.rfOutputVsProbability
    : SHAP_TOLERANCES.xgbSigmoidVsProbability;
  if (Math.abs(outputAsProbability - response.probability_no_show) > probabilityTolerance) {
    throw violation(operation, 'explanation.model_output_in_explanation_space');
  }

  return response;
}

export function validateBatchResponse(
  data: unknown,
  expected: { mode: 'single' | 'compare'; itemCount: number; modelKey?: MlModelKey },
): MlBatchResponse {
  const operation: MlOperation = 'batch';
  const response = parseOrThrow(BatchResponseSchema, data, operation);

  if (response.mode !== expected.mode) throw violation(operation, 'mode');
  if (response.count !== expected.itemCount || response.results.length !== expected.itemCount) {
    throw violation(operation, 'count');
  }

  // Índices 0..n-1, únicos y en orden: se verifica ANTES de que alguien persista nada.
  for (const [position, item] of response.results.entries()) {
    if (item.index !== position) throw violation(operation, `results.${position}.index`);
  }

  if (response.mode === 'single') {
    for (const [position, item] of response.results.entries()) {
      assertAlgorithmMatchesKey(item.prediction, operation, `results.${position}.prediction`);
      if (expected.modelKey && item.prediction.model_key !== expected.modelKey) {
        throw violation(operation, `results.${position}.prediction.model_key`);
      }
    }
  } else {
    for (const item of response.results) {
      validateCompareResponse(item.prediction, operation);
    }
  }

  return response;
}

export function validateModelsResponse(data: unknown): MlModelsResponse {
  const operation: MlOperation = 'models';
  const response = parseOrThrow(ModelsResponseSchema, data, operation);

  for (const [index, model] of response.models.entries()) {
    if (ML_ALGORITHM_BY_MODEL_KEY[model.model_key] !== model.algorithm) {
      throw violation(operation, `models.${index}.algorithm`);
    }
    const columnsMatch =
      model.predictor_columns.length === PREDICTOR_COLUMNS.length &&
      model.predictor_columns.every((column, position) => column === PREDICTOR_COLUMNS[position]);
    if (!columnsMatch) throw violation(operation, `models.${index}.predictor_columns`);
  }

  const keys = response.models.map((model) => model.model_key);
  if (new Set(keys).size !== keys.length) throw violation(operation, 'models');

  return response;
}

export function validateReadyResponse(data: unknown): MlReadyResponse {
  return parseOrThrow(ReadyResponseSchema, data, 'ready');
}
