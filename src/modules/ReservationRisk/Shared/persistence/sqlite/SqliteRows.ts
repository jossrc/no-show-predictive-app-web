import { PersistenceUnavailableException } from '../../../../../infrastructure/database/errors/PersistenceUnavailableException.js';
import {
  isMlModelKey,
  type PredictionFeatures,
} from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { SnapshotEvidenceSource } from '../../../../../shared/data/DataSourceMode.js';
import type { BookingFeatureSnapshot } from '../../models/BookingFeatureSnapshot.js';
import type { ExperimentalRisk, ExperimentalRiskLevel } from '../../models/ExperimentalRisk.js';
import type { ModelScore, ScoringApiVersion } from '../../models/ModelScore.js';
import type { RiskLevel } from '../../policy/RiskLevelPolicy.js';

export type SqliteRow = Record<string, unknown>;

const SQLITE_CONSTRAINT = 19;

/** Fallo del almacén local a excepción segura: sin SQL, rutas ni valores. */
export function toStoreException(
  operation: string,
  error: unknown,
): PersistenceUnavailableException {
  if (error instanceof PersistenceUnavailableException) return error;
  const errcode = (error as { errcode?: unknown } | null)?.errcode;
  const isConstraint = typeof errcode === 'number' && (errcode & 0xff) === SQLITE_CONSTRAINT;
  return new PersistenceUnavailableException({
    operation,
    reason: isConstraint ? 'INTEGRITY_VIOLATION' : 'QUERY_FAILED',
    cause: error,
  });
}

function text(row: SqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new TypeError(`Columna ${column} inválida`);
  return value;
}

function nullableText(row: SqliteRow, column: string): string | null {
  const value = row[column];
  return value === null || value === undefined ? null : text(row, column);
}

function real(row: SqliteRow, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Columna ${column} inválida`);
  }
  return value;
}

function date(row: SqliteRow, column: string): Date {
  const value = new Date(text(row, column));
  if (Number.isNaN(value.getTime())) throw new TypeError(`Columna ${column} inválida`);
  return value;
}

export function iso(instant: Date): string {
  return instant.toISOString();
}

export function mapSnapshotRow(row: SqliteRow): BookingFeatureSnapshot {
  return {
    snapshotId: String(row.snapshot_id),
    reservationId: text(row, 'reservation_id'),
    clientId: text(row, 'client_id'),
    snapshotType: 'booking_creation',
    predictionAt: date(row, 'prediction_at'),
    appointmentAt: date(row, 'appointment_at'),
    featureVersion: text(row, 'feature_version'),
    builderVersion: text(row, 'builder_version'),
    snapshotHash: text(row, 'snapshot_hash'),
    // Integridad completa (contrato + hash) se verifica al reutilizarlo: VerifySnapshotIntegrity.
    features: JSON.parse(text(row, 'features_json')) as PredictionFeatures,
    evidenceSource: text(row, 'evidence_source') as SnapshotEvidenceSource,
    createdAt: date(row, 'created_at'),
  };
}

export function mapExperimentalRisk(row: SqliteRow): ExperimentalRisk | null {
  if (row.experimental_level === null || row.experimental_level === undefined) return null;
  const warnings: unknown = JSON.parse(text(row, 'experimental_warnings_json'));
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

export function mapResultRow(row: SqliteRow): ModelScore {
  const modelKey = row.model_key;
  if (!isMlModelKey(modelKey) || row.operational_use_allowed !== 0) {
    // Los CHECK lo impiden; se verifica de nuevo para no propagar estados operativos falsos.
    throw new TypeError('Resultado persistido fuera de contrato');
  }
  return {
    resultId: String(row.result_id),
    predictionRunId: text(row, 'run_uid'),
    snapshotId: String(row.snapshot_id),
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

export const RESULT_COLUMNS = `
  r.result_id, pr.run_uid, r.snapshot_id, r.model_key, r.algorithm, r.model_version,
  r.model_hash, r.model_hash_sha256, r.feature_version, r.prediction_at, r.scored_at,
  r.probability_no_show, r.validation_status, r.calibration_status, r.operational_use_allowed,
  r.risk_level, r.risk_policy_version, r.risk_policy_status, r.scoring_api_version,
  r.experimental_level, r.experimental_label, r.experimental_policy_id,
  r.experimental_policy_version, r.experimental_policy_hash,
  r.experimental_low_upper_threshold, r.experimental_high_lower_threshold,
  r.experimental_boundary_rule, r.experimental_warnings_json`;
