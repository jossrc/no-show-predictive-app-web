import { PREDICTOR_COLUMNS } from '../../../../infrastructure/http/ml/MlFeatureContract.js';

export interface FeatureIssue {
  readonly field: string;
  readonly reason: string;
}

/** Tolerancia absoluta de la tasa histórica acordada con el servicio Python. */
export const NO_SHOW_RATE_TOLERANCE = 1e-6;

type Rule =
  | { kind: 'int'; min: number; max?: number; nullable: boolean; exclusiveMin?: boolean }
  | { kind: 'number'; min: number; max?: number; nullable: boolean; exclusiveMin?: boolean }
  | { kind: 'bool'; nullable: boolean }
  | { kind: 'sex' };

/** Reglas por predictora derivadas de PredictionFeatures (OpenAPI ml-internal-v1). */
const RULES: Readonly<Record<(typeof PREDICTOR_COLUMNS)[number], Rule>> = {
  age_at_booking: { kind: 'int', min: 16, max: 95, nullable: true },
  client_sex: { kind: 'sex' },
  booking_lead_days: { kind: 'number', min: 0, exclusiveMin: true, nullable: false },
  appointment_month: { kind: 'int', min: 1, max: 12, nullable: false },
  appointment_weekday: { kind: 'int', min: 1, max: 7, nullable: false },
  appointment_hour: { kind: 'int', min: 0, max: 23, nullable: false },
  duration_minutes: { kind: 'int', min: 0, nullable: true },
  is_fwa: { kind: 'bool', nullable: true },
  clinic_id: { kind: 'int', min: 0, exclusiveMin: true, nullable: false },
  scheduled_service_lines: { kind: 'int', min: 0, nullable: false },
  distinct_body_areas: { kind: 'int', min: 0, nullable: false },
  single_body_area_id: { kind: 'int', min: 0, exclusiveMin: true, nullable: true },
  has_medical_evaluation: { kind: 'bool', nullable: true },
  has_type4_service: { kind: 'bool', nullable: true },
  previous_attended: { kind: 'int', min: 0, nullable: false },
  previous_no_show: { kind: 'int', min: 0, nullable: false },
  previous_no_show_rate: { kind: 'number', min: 0, max: 1, nullable: true },
  days_since_previous_attended: { kind: 'number', min: 0, nullable: true },
  days_since_previous_no_show: { kind: 'number', min: 0, nullable: true },
};

function checkRule(field: string, value: unknown, rule: Rule): FeatureIssue | null {
  if (value === null) {
    const nullable = rule.kind === 'sex' || rule.nullable;
    return nullable ? null : { field, reason: 'null_not_allowed' };
  }

  if (rule.kind === 'sex') {
    return value === 'M' || value === 'F' || value === 'X'
      ? null
      : { field, reason: 'invalid_enum' };
  }
  if (rule.kind === 'bool') {
    return typeof value === 'boolean' ? null : { field, reason: 'not_boolean' };
  }

  // Sin coerción: strings numéricos, booleanos, NaN e Infinity se rechazan.
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { field, reason: 'not_finite_number' };
  }
  if (rule.kind === 'int' && !Number.isSafeInteger(value)) {
    return { field, reason: 'not_safe_integer' };
  }
  if (rule.exclusiveMin ? value <= rule.min : value < rule.min) {
    return { field, reason: 'below_minimum' };
  }
  if (rule.max !== undefined && value > rule.max) {
    return { field, reason: 'above_maximum' };
  }
  return null;
}

function crossFieldIssues(features: Record<string, unknown>): FeatureIssue[] {
  const issues: FeatureIssue[] = [];
  const lines = features.scheduled_service_lines as number;
  const areas = features.distinct_body_areas as number;
  const singleArea = features.single_body_area_id;
  const attended = features.previous_attended as number;
  const noShow = features.previous_no_show as number;
  const rate = features.previous_no_show_rate;

  if (areas > lines) issues.push({ field: 'distinct_body_areas', reason: 'exceeds_service_lines' });
  if ((areas === 1) !== (singleArea !== null)) {
    issues.push({ field: 'single_body_area_id', reason: 'inconsistent_with_distinct_body_areas' });
  }

  const total = attended + noShow;
  if (total === 0 && rate !== null) {
    issues.push({ field: 'previous_no_show_rate', reason: 'must_be_null_without_history' });
  }
  if (total > 0) {
    if (rate === null) {
      issues.push({ field: 'previous_no_show_rate', reason: 'required_with_history' });
    } else if (Math.abs((rate as number) - noShow / total) > NO_SHOW_RATE_TOLERANCE) {
      issues.push({ field: 'previous_no_show_rate', reason: 'inconsistent_ratio' });
    }
  }
  if (attended === 0 && features.days_since_previous_attended !== null) {
    issues.push({ field: 'days_since_previous_attended', reason: 'must_be_null_without_events' });
  }
  if (noShow === 0 && features.days_since_previous_no_show !== null) {
    issues.push({ field: 'days_since_previous_no_show', reason: 'must_be_null_without_events' });
  }

  return issues;
}

/**
 * Valida el objeto de 19 predictoras con el mismo rigor que el servicio Python:
 * claves exactas (sin extras, nulls explícitos), tipos estrictos, rangos y coherencia cruzada.
 */
export function validateFeatureSnapshot(candidate: unknown): FeatureIssue[] {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return [{ field: 'features', reason: 'not_object' }];
  }

  const features = candidate as Record<string, unknown>;
  const issues: FeatureIssue[] = [];
  const allowed = new Set<string>(PREDICTOR_COLUMNS);

  for (const key of Object.keys(features)) {
    if (!allowed.has(key)) issues.push({ field: '[extra]', reason: 'unexpected_field' });
  }

  for (const column of PREDICTOR_COLUMNS) {
    if (!Object.hasOwn(features, column) || features[column] === undefined) {
      issues.push({ field: column, reason: 'missing' });
      continue;
    }
    const issue = checkRule(column, features[column], RULES[column]);
    if (issue) issues.push(issue);
  }

  return issues.length > 0 ? issues : crossFieldIssues(features);
}
