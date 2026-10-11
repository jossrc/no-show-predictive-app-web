/**
 * Contrato de entrada del servicio depi-noshow-ml v1 (BOOKING_BASELINE_V1).
 * Fuente: depi-noshow-ml/src/depi_ml/datasets/schema.py::PREDICTOR_COLUMNS y
 * docs/contracts/ml-internal-v1.openapi.json (commit f2f30b5f). El orden es canónico.
 */
export const ML_FEATURE_VERSION = 'BOOKING_BASELINE_V1';
export const ML_SNAPSHOT_TYPE = 'booking_creation';

export const PREDICTOR_COLUMNS = [
  'age_at_booking',
  'client_sex',
  'booking_lead_days',
  'appointment_month',
  'appointment_weekday',
  'appointment_hour',
  'duration_minutes',
  'is_fwa',
  'clinic_id',
  'scheduled_service_lines',
  'distinct_body_areas',
  'single_body_area_id',
  'has_medical_evaluation',
  'has_type4_service',
  'previous_attended',
  'previous_no_show',
  'previous_no_show_rate',
  'days_since_previous_attended',
  'days_since_previous_no_show',
] as const;

export type PredictorName = (typeof PREDICTOR_COLUMNS)[number];

export type ClientSex = 'M' | 'F' | 'X';

/** Las 19 predictoras exactas; null explícito cuando el valor es desconocido. */
export interface PredictionFeatures {
  age_at_booking: number | null;
  client_sex: ClientSex | null;
  booking_lead_days: number;
  appointment_month: number;
  appointment_weekday: number;
  appointment_hour: number;
  duration_minutes: number | null;
  is_fwa: boolean | null;
  clinic_id: number;
  scheduled_service_lines: number;
  distinct_body_areas: number;
  single_body_area_id: number | null;
  has_medical_evaluation: boolean | null;
  has_type4_service: boolean | null;
  previous_attended: number;
  previous_no_show: number;
  previous_no_show_rate: number | null;
  days_since_previous_attended: number | null;
  days_since_previous_no_show: number | null;
}

export const ML_MODEL_KEYS = ['random_forest_full_v1', 'xgboost_full_v1'] as const;
export type MlModelKey = (typeof ML_MODEL_KEYS)[number];

export const ML_ALGORITHM_BY_MODEL_KEY: Readonly<Record<MlModelKey, 'random_forest' | 'xgboost'>> =
  {
    random_forest_full_v1: 'random_forest',
    xgboost_full_v1: 'xgboost',
  };

export const DEFAULT_ML_MODEL_KEY: MlModelKey = 'random_forest_full_v1';

export function isMlModelKey(value: unknown): value is MlModelKey {
  return typeof value === 'string' && (ML_MODEL_KEYS as readonly string[]).includes(value);
}

/** Serializa las predictoras en orden canónico, sin claves extra ni ausentes. */
export function toCanonicalFeatures(features: PredictionFeatures): PredictionFeatures {
  const canonical: Record<string, unknown> = {};
  for (const column of PREDICTOR_COLUMNS) {
    if (!Object.hasOwn(features, column)) {
      throw new TypeError(`Falta la predictora ${column}`);
    }
    canonical[column] = features[column];
  }

  const extra = Object.keys(features).filter(
    (key) => !(PREDICTOR_COLUMNS as readonly string[]).includes(key),
  );
  if (extra.length > 0) {
    throw new TypeError('El objeto de predictoras contiene claves no contractuales');
  }

  return canonical as unknown as PredictionFeatures;
}
