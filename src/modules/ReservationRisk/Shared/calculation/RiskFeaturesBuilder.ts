import {
  ML_FEATURE_VERSION,
  ML_SNAPSHOT_TYPE,
  type ClientSex,
  type PredictionFeatures,
} from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import {
  compareLocalDates,
  completedYears,
  limaCalendarDate,
  parseLocalDate,
  toLimaParts,
} from '../../../../shared/time/LimaTime.js';
import type { ClientHistoryAsOfSummary } from '../../../ClientHistory/Shared/models/ClientHistoryAsOfSummary.js';
import {
  notScorableReason,
  type NotScorableReason,
  type NotScorableReasonCode,
} from '../models/NotScorableReason.js';
import type {
  ScheduledServiceLine,
  VerifiedBookingSnapshot,
} from '../models/VerifiedBookingSnapshot.js';

export const RISK_FEATURES_BUILDER_VERSION = 'risk_features_builder_v1';
/** Filtro del ETL 14 de entrenamiento: anticipación > 730 días queda fuera de población. */
export const MAX_TRAINING_LEAD_DAYS = 730;
export const MIN_MODEL_AGE = 16;
/**
 * Auditoría read-only 2026-10-12: appointment_training_dataset_v1 solo contiene ISODOW 1–6
 * (0 domingos en 213.873 filas; 0 discrepancias con ISODOW de appointment_at en Lima). Un
 * domingo se envía como 7 (ISO, igual que el ETL 14) y se advierte: fuera de la distribución
 * de entrenamiento. Nunca se reetiqueta 7→0.
 */
export const WEEKDAYS_ABSENT_FROM_TRAINING: readonly number[] = [7];
export const MAX_MODEL_AGE = 95;

const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;
const CLIENT_SEX_VALUES: readonly ClientSex[] = ['M', 'F', 'X'];

export type FeatureWarning =
  | 'UNKNOWN_BIRTH_DATE'
  | 'BIRTH_DATE_AFTER_BOOKING'
  | 'AGE_OUT_OF_MODEL_RANGE'
  | 'UNEXPECTED_CLIENT_SEX_VALUE'
  | 'END_BEFORE_START_DURATION_NULL'
  | 'ZERO_SCHEDULED_SERVICES_OUT_OF_TRAINING_POPULATION'
  | 'WEEKDAY_ABSENT_FROM_TRAINING_DATA'
  | 'POSITIVE_COUNT_WITHOUT_RECENCY';

export interface BuiltRiskFeatures {
  readonly featureVersion: typeof ML_FEATURE_VERSION;
  readonly featureContext: {
    readonly snapshot_type: typeof ML_SNAPSHOT_TYPE;
    readonly builder_version: typeof RISK_FEATURES_BUILDER_VERSION;
  };
  readonly features: PredictionFeatures;
  readonly warnings: readonly FeatureWarning[];
}

export type RiskFeaturesBuildResult =
  | { readonly kind: 'BUILT'; readonly value: BuiltRiskFeatures }
  | { readonly kind: 'NOT_SCORABLE'; readonly reasons: readonly NotScorableReason[] };

function isBefore(candidate: Date | null, cutoff: Date): boolean {
  return candidate === null || candidate.getTime() < cutoff.getTime();
}

function isNonNegativeSafeInt(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function toSafeIdNumber(id: string): number {
  // Si excede el rango seguro, el validador posterior lo rechaza (no se redondea en silencio).
  return Number(id);
}

/** OR trivalente: true si alguna es true; null si hay desconocidos; false si todas son false. */
function anyTrue(values: readonly (boolean | null)[]): boolean | null {
  if (values.some((value) => value === true)) return true;
  if (values.some((value) => value === null)) return null;
  return false;
}

/**
 * Única transformación tipada (VerifiedBookingSnapshot + historial as-of) → 19 predictoras.
 * Pura y determinista: no lee reloj, BD ni HTTP; no conoce Fastify. No transporta target, IDs
 * ni metadatos de la reserva dentro de las predictoras. Paridad con ETL 14 salvo donde se
 * documenta (docs/sprint-01/feature_lineage.md).
 */
export class RiskFeaturesBuilder {
  build(
    snapshot: VerifiedBookingSnapshot,
    history: ClientHistoryAsOfSummary,
  ): RiskFeaturesBuildResult {
    const blocking = this.blockingReasons(snapshot, history);
    if (blocking.length > 0) {
      return { kind: 'NOT_SCORABLE', reasons: blocking.map(notScorableReason) };
    }

    const warnings: FeatureWarning[] = [];
    const predictionAt = snapshot.predictionAt;
    const appointment = toLimaParts(snapshot.appointmentAt);
    const lines = snapshot.scheduledServices;
    const services = this.serviceFeatures(lines);
    if (lines.length === 0) warnings.push('ZERO_SCHEDULED_SERVICES_OUT_OF_TRAINING_POPULATION');
    if (WEEKDAYS_ABSENT_FROM_TRAINING.includes(appointment.isoWeekday)) {
      warnings.push('WEEKDAY_ABSENT_FROM_TRAINING_DATA');
    }

    const attended = history.previousAttended;
    const noShow = history.previousNoShow;
    const total = attended + noShow;

    const features: PredictionFeatures = {
      age_at_booking: this.ageAtBooking(snapshot.clientBirthDate, predictionAt, warnings),
      client_sex: this.clientSex(snapshot.clientSex, warnings),
      booking_lead_days: (snapshot.appointmentAt.getTime() - predictionAt.getTime()) / MS_PER_DAY,
      appointment_month: appointment.month,
      appointment_weekday: appointment.isoWeekday,
      appointment_hour: appointment.hour,
      duration_minutes: this.durationMinutes(snapshot, warnings),
      is_fwa: snapshot.fwaFlag === null ? null : snapshot.fwaFlag !== 0,
      clinic_id: snapshot.clinicId,
      scheduled_service_lines: lines.length,
      distinct_body_areas: services.distinctBodyAreas,
      single_body_area_id: services.singleBodyAreaId,
      has_medical_evaluation: anyTrue(lines.map((line) => line.isMedicalEvaluation)),
      has_type4_service: anyTrue(
        lines.map((line) => (line.productType === null ? null : line.productType === 4)),
      ),
      previous_attended: attended,
      previous_no_show: noShow,
      previous_no_show_rate: total > 0 ? noShow / total : null,
      days_since_previous_attended: this.recencyDays(
        attended,
        history.lastAttendedAt,
        predictionAt,
        warnings,
      ),
      days_since_previous_no_show: this.recencyDays(
        noShow,
        history.lastNoShowAt,
        predictionAt,
        warnings,
      ),
    };

    return {
      kind: 'BUILT',
      value: {
        featureVersion: ML_FEATURE_VERSION,
        featureContext: {
          snapshot_type: ML_SNAPSHOT_TYPE,
          builder_version: RISK_FEATURES_BUILDER_VERSION,
        },
        features,
        warnings,
      },
    };
  }

  private blockingReasons(
    snapshot: VerifiedBookingSnapshot,
    history: ClientHistoryAsOfSummary,
  ): NotScorableReasonCode[] {
    const reasons: NotScorableReasonCode[] = [];
    const predictionMs = snapshot.predictionAt.getTime();
    const appointmentMs = snapshot.appointmentAt.getTime();

    if (!Number.isFinite(predictionMs) || !Number.isFinite(appointmentMs)) {
      return ['INVALID_SOURCE_VALUE'];
    }
    if (appointmentMs <= predictionMs) reasons.push('BOOKING_NOT_BEFORE_APPOINTMENT');
    if ((appointmentMs - predictionMs) / MS_PER_DAY > MAX_TRAINING_LEAD_DAYS) {
      reasons.push('LEAD_TIME_OUT_OF_TRAINING_RANGE');
    }

    // Guardas anti-fuga: el historial debe ser del mismo cliente y estrictamente anterior.
    const historyAsOf =
      history.clientId === snapshot.clientId &&
      history.cutoffAt.getTime() === predictionMs &&
      isBefore(history.latestKnownAt, snapshot.predictionAt) &&
      isBefore(history.lastAttendedAt, snapshot.predictionAt) &&
      isBefore(history.lastNoShowAt, snapshot.predictionAt);
    if (!historyAsOf) reasons.push('HISTORY_NOT_AS_OF');

    const countsCoherent =
      isNonNegativeSafeInt(history.previousAttended) &&
      isNonNegativeSafeInt(history.previousNoShow) &&
      (history.previousAttended > 0 || history.lastAttendedAt === null) &&
      (history.previousNoShow > 0 || history.lastNoShowAt === null);
    if (!countsCoherent) reasons.push('INVALID_SOURCE_VALUE');

    return reasons;
  }

  private ageAtBooking(
    rawBirthDate: string | null,
    predictionAt: Date,
    warnings: FeatureWarning[],
  ): number | null {
    const birth = rawBirthDate === null ? null : parseLocalDate(rawBirthDate);
    if (birth === null) {
      warnings.push('UNKNOWN_BIRTH_DATE');
      return null;
    }

    // Edad al RESERVAR (no a la fecha de la cita), en calendario de Lima.
    const bookingDate = limaCalendarDate(predictionAt);
    if (compareLocalDates(birth, bookingDate) > 0) {
      warnings.push('BIRTH_DATE_AFTER_BOOKING');
      return null;
    }

    const years = completedYears(birth, bookingDate);
    if (years < MIN_MODEL_AGE || years > MAX_MODEL_AGE) {
      warnings.push('AGE_OUT_OF_MODEL_RANGE');
      return null;
    }
    return years;
  }

  private clientSex(raw: string | null, warnings: FeatureWarning[]): ClientSex | null {
    if (raw === null) return null;
    if ((CLIENT_SEX_VALUES as readonly string[]).includes(raw)) return raw as ClientSex;
    // Sin normalización (mayúsculas, recortes): un valor no contractual es desconocido.
    warnings.push('UNEXPECTED_CLIENT_SEX_VALUE');
    return null;
  }

  private durationMinutes(
    snapshot: VerifiedBookingSnapshot,
    warnings: FeatureWarning[],
  ): number | null {
    if (snapshot.appointmentEndAt === null) return null;

    const minutes =
      (snapshot.appointmentEndAt.getTime() - snapshot.appointmentAt.getTime()) / MS_PER_MINUTE;
    if (!Number.isFinite(minutes) || minutes < 0) {
      warnings.push('END_BEFORE_START_DURATION_NULL');
      return null;
    }
    return Math.round(minutes);
  }

  private serviceFeatures(lines: readonly ScheduledServiceLine[]): {
    distinctBodyAreas: number;
    singleBodyAreaId: number | null;
  } {
    const areas = new Set(
      lines.flatMap((line) => (line.bodyAreaProductId === null ? [] : [line.bodyAreaProductId])),
    );
    const [onlyArea] = [...areas];
    return {
      distinctBodyAreas: areas.size,
      singleBodyAreaId:
        areas.size === 1 && onlyArea !== undefined ? toSafeIdNumber(onlyArea) : null,
    };
  }

  private recencyDays(
    count: number,
    lastKnownAt: Date | null,
    predictionAt: Date,
    warnings: FeatureWarning[],
  ): number | null {
    if (count === 0) return null;
    if (lastKnownAt === null) {
      warnings.push('POSITIVE_COUNT_WITHOUT_RECENCY');
      return null;
    }
    return (predictionAt.getTime() - lastKnownAt.getTime()) / MS_PER_DAY;
  }
}
