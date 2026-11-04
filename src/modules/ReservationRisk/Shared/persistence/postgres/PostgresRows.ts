import {
  isMlModelKey,
  type PredictionFeatures,
} from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { SnapshotEvidenceSource } from '../../../../../shared/data/DataSourceMode.js';
import type { BookingFeatureSnapshot } from '../../models/BookingFeatureSnapshot.js';
import type { ExperimentalRisk, ExperimentalRiskLevel } from '../../models/ExperimentalRisk.js';
import type { ModelScore, ScoringApiVersion } from '../../models/ModelScore.js';
import type { RiskLevel } from '../../policy/RiskLevelPolicy.js';

/**
 * Filas del almacén PostgreSQL ml.app_*. Con los parsers por defecto de `pg`: bigint → string
 * decimal (sin pérdida), timestamptz → Date, double precision → number, jsonb → objeto.
 */
export type PgRow = Record<string, unknown>;

function text(row: PgRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new TypeError(`Columna ${column} inválida`);
  return value;
}

function nullableText(row: PgRow, column: string): string | null {
  const value = row[column];
  return value === null || value === undefined ? null : text(row, column);
}

function real(row: PgRow, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Columna ${column} inválida`);
  }
  return value;
}

function date(row: PgRow, column: string): Date {
  const value = row[column];
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`Columna ${column} inválida`);
  }
  return value;
}

export function mapSnapshotRow(row: PgRow): BookingFeatureSnapshot {
  return {
    snapshotId: text(row, 'snapshot_id'),
    reservationId: text(row, 'reservation_id'),
    clientId: text(row, 'client_id'),
    snapshotType: 'booking_creation',
    predictionAt: date(row, 'prediction_at'),
    appointmentAt: date(row, 'appointment_at'),
    featureVersion: text(row, 'feature_version'),
    builderVersion: text(row, 'builder_version'),
    snapshotHash: text(row, 'snapshot_hash'),
    // Integridad completa (contrato + hash) se verifica al reutilizarlo: VerifySnapshotIntegrity.
    features: row.features as PredictionFeatures,
    evidenceSource: text(row, 'evidence_source') as SnapshotEvidenceSource,
    createdAt: date(row, 'created_at'),
  };
}

export function mapExperimentalRisk(row: PgRow): ExperimentalRisk | null {
  if (row.experimental_level === null || row.experimental_level === undefined) return null;
  const warnings = row.experimental_warnings;
  return {
    level: text(row, 'experimental_level') as ExperimentalRiskLevel,
    label: text(row, 'experimental_label') as ExperimentalRisk['label'],
    status: 'RESEARCH_PROVISIONAL',
    policyId: text(row, 'experimental_policy_id'),
    policyVersion: text(row, 'experimental_policy_version'),
    policyHash: text(row, 'experimental_policy_hash'),
    lowUpperThreshold: real(row, 'experimental_low_upper_threshold'),
    highLowerThreshold: real(row, 'experimental_high_lower_threshold'),
    boundaryRule: text(row, 'experimental_boundary_rule'),
    meaning: 'relative_score_band_not_validated_absolute_risk',
    scoreSpace: 'raw_probability_no_show',
    warnings: Array.isArray(warnings) ? warnings.map(String) : [],
    approvedBy: null,
    operationalUseAllowed: false,
  };
}

export function mapResultRow(row: PgRow): ModelScore {
  const modelKey = row.model_key;
  if (!isMlModelKey(modelKey) || row.operational_use_allowed !== false) {
    // Los CHECK lo impiden; se verifica de nuevo para no propagar estados operativos falsos.
    throw new TypeError('Resultado persistido fuera de contrato');
  }
  return {
    resultId: text(row, 'result_id'),
    predictionRunId: text(row, 'run_uid'),
    snapshotId: text(row, 'snapshot_id'),
    modelKey,
    algorithm: text(row, 'algorithm') as ModelScore['algorithm'],
    modelVersion: text(row, 'model_version'),
    modelHash: text(row, 'model_hash'),
    featureVersion: text(row, 'feature_version'),
    predictionAt: date(row, 'prediction_at'),
    scoredAt: date(row, 'scored_at'),
    probabilityNoShow: real(row, 'probability_no_show'),
    predictionTarget: 'NO_SHOW_CANDIDATE',
    validationStatus: text(row, 'validation_status'),
    calibrationStatus: text(row, 'calibration_status'),
    operationalUseAllowed: false,
    riskLevel: nullableText(row, 'risk_level') as RiskLevel | null,
    riskPolicyVersion: nullableText(row, 'risk_policy_version'),
    riskPolicyStatus: text(row, 'risk_policy_status'),
    scoringApiVersion: text(row, 'scoring_api_version') as ScoringApiVersion,
    modelHashSha256: nullableText(row, 'model_hash_sha256'),
    experimentalRisk: mapExperimentalRisk(row),
  };
}

export const SNAPSHOT_COLUMNS = `
  snapshot_id::text AS snapshot_id, reservation_id::text AS reservation_id,
  client_id::text AS client_id, snapshot_type, prediction_at, appointment_at, feature_version,
  builder_version, snapshot_hash, features, evidence_source, created_at`;

export const RESULT_COLUMNS = `
  r.result_id::text AS result_id, pr.run_uid::text AS run_uid, r.snapshot_id::text AS snapshot_id,
  r.model_key, r.algorithm, r.model_version, r.model_hash, r.model_hash_sha256, r.feature_version,
  r.prediction_at, r.scored_at, r.probability_no_show, r.validation_status, r.calibration_status,
  r.operational_use_allowed, r.risk_level, r.risk_policy_version, r.risk_policy_status,
  r.scoring_api_version, r.experimental_level, r.experimental_label, r.experimental_policy_id,
  r.experimental_policy_version, r.experimental_policy_hash, r.experimental_low_upper_threshold,
  r.experimental_high_lower_threshold, r.experimental_boundary_rule, r.experimental_warnings`;
