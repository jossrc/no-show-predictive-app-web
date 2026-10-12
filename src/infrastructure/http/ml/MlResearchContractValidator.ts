import type { z } from 'zod';
import type {
  MlExperimentalRisk,
  MlExperimentalRiskLevel,
  MlResearchCompareResponse,
  MlResearchPolicyCatalog,
  MlResearchPolicyView,
  MlResearchPredictionResponse,
} from './MlContractTypes.js';
import { SHAP_TOLERANCES } from './MlContractValidator.js';
import { ML_ALGORITHM_BY_MODEL_KEY, ML_MODEL_KEYS, type MlModelKey } from './MlFeatureContract.js';
import type { MlOperation } from './MlHttpErrorMapper.js';
import {
  EXPERIMENTAL_RISK_LABELS,
  ResearchCompareResponseSchema,
  ResearchPolicyCatalogSchema,
  ResearchPredictionResponseSchema,
} from './MlResearchContractSchemas.js';
import { MlContractViolationException } from './errors/MlContractViolationException.js';

/** |percent − 100·p|: Python calcula `p*100` en float64; se admite solo ruido de redondeo. */
export const PERCENT_TOLERANCE = 1e-9;

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

/**
 * Regla de bandas publicada en el contrato (`boundary_rule`), aplicada SOLO como verificación de
 * integridad de la respuesta recibida con los límites que la propia respuesta declara. Node
 * nunca clasifica scores por su cuenta ni conserva umbrales propios.
 */
export function bandImpliedByContract(
  probability: number,
  risk: Pick<MlExperimentalRisk, 'low_upper_threshold' | 'high_lower_threshold'>,
): MlExperimentalRiskLevel {
  if (probability < risk.low_upper_threshold) return 'LOW';
  if (probability < risk.high_lower_threshold) return 'MEDIUM';
  return 'HIGH';
}

function assertExperimentalRiskCoherent(
  score: MlResearchPredictionResponse,
  operation: MlOperation,
  path: string,
): void {
  const risk = score.experimental_risk;
  if (!(risk.low_upper_threshold < risk.high_lower_threshold)) {
    throw violation(operation, `${path}.experimental_risk.low_upper_threshold`);
  }
  if (risk.label !== EXPERIMENTAL_RISK_LABELS[risk.level]) {
    throw violation(operation, `${path}.experimental_risk.label`);
  }
  if (bandImpliedByContract(score.probability_no_show, risk) !== risk.level) {
    throw violation(operation, `${path}.experimental_risk.level`);
  }
}

/** Identidad del artefacto: hash corto = prefijo del SHA-256 y versión `<key>:<hash>`. */
function assertModelIdentity(
  score: Pick<
    MlResearchPredictionResponse,
    'model_key' | 'algorithm' | 'model_version' | 'model_hash' | 'model_hash_sha256'
  >,
  operation: MlOperation,
  path: string,
): void {
  if (ML_ALGORITHM_BY_MODEL_KEY[score.model_key] !== score.algorithm) {
    throw violation(operation, `${path}.algorithm`);
  }
  if (!score.model_hash_sha256.startsWith(score.model_hash)) {
    throw violation(operation, `${path}.model_hash_sha256`);
  }
  if (score.model_version !== `${score.model_key}:${score.model_hash}`) {
    throw violation(operation, `${path}.model_version`);
  }
}

function assertResearchScore(
  score: MlResearchPredictionResponse,
  operation: MlOperation,
  path: string,
): void {
  assertModelIdentity(score, operation, path);
  if (
    Math.abs(score.probability_no_show_percent - score.probability_no_show * 100) >
    PERCENT_TOLERANCE
  ) {
    throw violation(operation, `${path}.probability_no_show_percent`);
  }
  assertExperimentalRiskCoherent(score, operation, path);
}

export function validateResearchPredictionResponse(
  data: unknown,
  expectedModelKey: MlModelKey,
): MlResearchPredictionResponse {
  const operation: MlOperation = 'research_predict';
  const score = parseOrThrow(ResearchPredictionResponseSchema, data, operation);
  if (score.model_key !== expectedModelKey) throw violation(operation, 'model_key');
  assertResearchScore(score, operation, 'response');
  return score;
}

export function validateResearchCompareResponse(data: unknown): MlResearchCompareResponse {
  const operation: MlOperation = 'research_compare';
  const response = parseOrThrow(ResearchCompareResponseSchema, data, operation);
  const [first, second] = response.results;

  if (first.model_key !== 'random_forest_full_v1' || second.model_key !== 'xgboost_full_v1') {
    throw violation(operation, 'results.model_key');
  }
  assertResearchScore(first, operation, 'results.0');
  assertResearchScore(second, operation, 'results.1');

  // Cada modelo con SU política: nunca una banda compartida ni combinada.
  if (
    first.experimental_risk.policy_hash === second.experimental_risk.policy_hash ||
    first.experimental_risk.policy_id === second.experimental_risk.policy_id
  ) {
    throw violation(operation, 'results.experimental_risk.policy_hash');
  }

  const expectedDifference = Math.abs(first.probability_no_show - second.probability_no_show);
  if (
    Math.abs(response.comparison.absolute_probability_difference - expectedDifference) >
    SHAP_TOLERANCES.comparisonDifference
  ) {
    throw violation(operation, 'comparison.absolute_probability_difference');
  }
  return response;
}

export function validateResearchPolicyCatalog(data: unknown): MlResearchPolicyCatalog {
  const operation: MlOperation = 'research_policy';
  const catalog = parseOrThrow(ResearchPolicyCatalogSchema, data, operation);

  if (!catalog.available) {
    if (catalog.status !== 'UNAVAILABLE' || catalog.reason === null) {
      throw violation(operation, 'status');
    }
    if (catalog.policies.length > 0) throw violation(operation, 'policies');
    return catalog;
  }

  if (catalog.status !== 'RESEARCH_PROVISIONAL' || catalog.reason !== null) {
    throw violation(operation, 'status');
  }
  const keys = catalog.policies.map((policy) => policy.model_key);
  if (keys.length !== ML_MODEL_KEYS.length || ML_MODEL_KEYS.some((key) => !keys.includes(key))) {
    throw violation(operation, 'policies.model_key');
  }
  const hashes = new Set(catalog.policies.map((policy) => policy.policy_hash));
  const ids = new Set(catalog.policies.map((policy) => policy.policy_id));
  if (hashes.size !== keys.length || ids.size !== keys.length) {
    throw violation(operation, 'policies.policy_hash');
  }
  for (const [index, policy] of catalog.policies.entries()) {
    if (!(policy.low_upper_threshold < policy.high_lower_threshold)) {
      throw violation(operation, `policies.${index}.low_upper_threshold`);
    }
    if (policy.model_version !== `${policy.model_key}:${policy.model_hash_sha256.slice(0, 12)}`) {
      throw violation(operation, `policies.${index}.model_version`);
    }
  }
  return catalog;
}

/**
 * Trazabilidad cruzada: la banda recibida debe proceder EXACTAMENTE de la política publicada en
 * el catálogo para ese modelo (id, versión, hash, límites, regla e identidad del artefacto).
 * Una discrepancia nunca se persiste.
 */
export function assertScoreMatchesPolicy(
  score: MlResearchPredictionResponse,
  policy: MlResearchPolicyView,
  operation: MlOperation,
): void {
  const risk = score.experimental_risk;
  const checks: Array<[boolean, string]> = [
    [score.model_key === policy.model_key, 'model_key'],
    [score.model_version === policy.model_version, 'model_version'],
    [score.model_hash_sha256 === policy.model_hash_sha256, 'model_hash_sha256'],
    [risk.policy_id === policy.policy_id, 'experimental_risk.policy_id'],
    [risk.policy_version === policy.policy_version, 'experimental_risk.policy_version'],
    [risk.policy_hash === policy.policy_hash, 'experimental_risk.policy_hash'],
    [
      risk.low_upper_threshold === policy.low_upper_threshold,
      'experimental_risk.low_upper_threshold',
    ],
    [
      risk.high_lower_threshold === policy.high_lower_threshold,
      'experimental_risk.high_lower_threshold',
    ],
    [risk.boundary_rule === policy.boundary_rule, 'experimental_risk.boundary_rule'],
  ];
  const failed = checks.filter(([ok]) => !ok).map(([, path]) => `${score.model_key}.${path}`);
  if (failed.length > 0) throw violation(operation, ...failed);
}
