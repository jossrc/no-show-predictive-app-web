import type { PredictorName } from '../../../../infrastructure/http/ml/MlFeatureContract.js';

/** Etiquetas legibles validadas 1:1 con las 19 predictoras; el nombre técnico se conserva. */
export const FEATURE_LABELS: Readonly<Record<PredictorName, string>> = {
  age_at_booking: 'Edad al reservar',
  client_sex: 'Sexo registrado',
  booking_lead_days: 'Días de anticipación de la reserva',
  appointment_month: 'Mes de la cita',
  appointment_weekday: 'Día de la semana de la cita',
  appointment_hour: 'Hora de la cita',
  duration_minutes: 'Duración programada (min)',
  is_fwa: 'Indicador FWA de la agenda',
  clinic_id: 'Sede',
  scheduled_service_lines: 'Servicios programados',
  distinct_body_areas: 'Áreas corporales distintas',
  single_body_area_id: 'Área corporal única',
  has_medical_evaluation: 'Incluye evaluación médica',
  has_type4_service: 'Incluye servicio tipo 4',
  previous_attended: 'Asistencias previas conocidas',
  previous_no_show: 'Inasistencias previas conocidas',
  previous_no_show_rate: 'Tasa histórica de inasistencia',
  days_since_previous_attended: 'Días desde la última asistencia',
  days_since_previous_no_show: 'Días desde la última inasistencia',
};

/**
 * Atributos sensibles: pueden aparecer como factor asociado, pero NO deben usarse para
 * políticas de intervención automática ni trato diferenciado.
 */
export const SENSITIVE_FEATURES: ReadonlySet<PredictorName> = new Set([
  'age_at_booking',
  'client_sex',
]);
