import type { SqliteMigration } from '../../../../../infrastructure/database/sqlite/SqliteDatabase.js';

/**
 * Esquema LOCAL del almacén predictivo (SQLite). Equivalente funcional de la migración PostgreSQL
 * `ml` 001 + banda experimental research v2, sin tocar PostgreSQL. Reglas:
 * - snapshots, runs y resultados son inmutables (triggers sin UPDATE/DELETE);
 * - idempotencia: UNIQUE(snapshot, modelo, versión, política research) — `research_policy_key`
 *   es el hash de política o '' para scores v1 sin banda;
 * - `risk_level` operativo solo con política APROBADA y versión; `operational_use_allowed`=0;
 * - banda experimental completa o ausente (todo-o-nada), coherente con su política.
 * Las versiones aplicadas nunca se editan: un cambio es una migración nueva (checksum).
 */
const V001_INITIAL = `
CREATE TABLE booking_feature_snapshots (
  snapshot_id INTEGER PRIMARY KEY,
  reservation_id TEXT NOT NULL CHECK (reservation_id GLOB '[1-9]*' AND reservation_id NOT GLOB '*[^0-9]*' AND length(reservation_id) <= 18),
  client_id TEXT NOT NULL CHECK (client_id GLOB '[1-9]*' AND client_id NOT GLOB '*[^0-9]*' AND length(client_id) <= 18),
  snapshot_type TEXT NOT NULL CHECK (snapshot_type = 'booking_creation'),
  prediction_at TEXT NOT NULL,
  appointment_at TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  builder_version TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL CHECK (length(snapshot_hash) = 64),
  features_json TEXT NOT NULL CHECK (json_valid(features_json)),
  evidence_source TEXT NOT NULL CHECK (evidence_source IN ('VERIFIED_BOOKING_SNAPSHOT', 'SYNTHETIC_DEMO_ONLY')),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  source_ingestion_batch_id TEXT,
  created_at TEXT NOT NULL,
  CHECK (prediction_at < appointment_at),
  UNIQUE (reservation_id, snapshot_hash)
) STRICT;

CREATE INDEX idx_snapshots_reservation
  ON booking_feature_snapshots (reservation_id, evidence_source, created_at DESC, snapshot_id DESC);

CREATE TABLE prediction_runs (
  run_id INTEGER PRIMARY KEY,
  run_uid TEXT NOT NULL UNIQUE CHECK (length(run_uid) = 36),
  snapshot_id INTEGER NOT NULL REFERENCES booking_feature_snapshots (snapshot_id),
  reservation_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('single', 'compare')),
  requested_model_keys_json TEXT NOT NULL CHECK (json_valid(requested_model_keys_json)),
  scoring_api_version TEXT NOT NULL CHECK (scoring_api_version IN ('v1', 'v2')),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 64),
  run_requested_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  ml_latency_ms INTEGER NOT NULL CHECK (ml_latency_ms >= 0)
) STRICT;

CREATE TABLE prediction_model_results (
  result_id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES prediction_runs (run_id),
  snapshot_id INTEGER NOT NULL REFERENCES booking_feature_snapshots (snapshot_id),
  reservation_id TEXT NOT NULL,
  model_key TEXT NOT NULL CHECK (model_key IN ('random_forest_full_v1', 'xgboost_full_v1')),
  algorithm TEXT NOT NULL CHECK (
    (model_key = 'random_forest_full_v1' AND algorithm = 'random_forest') OR
    (model_key = 'xgboost_full_v1' AND algorithm = 'xgboost')),
  model_version TEXT NOT NULL,
  model_hash TEXT NOT NULL,
  model_hash_sha256 TEXT CHECK (model_hash_sha256 IS NULL OR length(model_hash_sha256) = 64),
  feature_version TEXT NOT NULL,
  prediction_at TEXT NOT NULL,
  scored_at TEXT NOT NULL,
  probability_no_show REAL NOT NULL CHECK (probability_no_show >= 0 AND probability_no_show <= 1),
  prediction_target TEXT NOT NULL CHECK (prediction_target = 'NO_SHOW_CANDIDATE'),
  validation_status TEXT NOT NULL,
  calibration_status TEXT NOT NULL,
  operational_use_allowed INTEGER NOT NULL CHECK (operational_use_allowed = 0),
  risk_level TEXT,
  risk_policy_version TEXT,
  risk_policy_status TEXT NOT NULL CHECK (risk_policy_status IN ('pending_validation', 'approved')),
  scoring_api_version TEXT NOT NULL CHECK (scoring_api_version IN ('v1', 'v2')),
  research_policy_key TEXT NOT NULL DEFAULT '',
  experimental_level TEXT CHECK (experimental_level IS NULL OR experimental_level IN ('LOW', 'MEDIUM', 'HIGH')),
  experimental_label TEXT,
  experimental_status TEXT CHECK (experimental_status IS NULL OR experimental_status = 'RESEARCH_PROVISIONAL'),
  experimental_policy_id TEXT,
  experimental_policy_version TEXT,
  experimental_policy_hash TEXT CHECK (experimental_policy_hash IS NULL OR length(experimental_policy_hash) = 64),
  experimental_low_upper_threshold REAL,
  experimental_high_lower_threshold REAL,
  experimental_boundary_rule TEXT,
  experimental_meaning TEXT,
  experimental_score_space TEXT,
  experimental_warnings_json TEXT CHECK (experimental_warnings_json IS NULL OR json_valid(experimental_warnings_json)),
  experimental_approved_by TEXT CHECK (experimental_approved_by IS NULL),
  experimental_operational_use_allowed INTEGER CHECK (experimental_operational_use_allowed IS NULL OR experimental_operational_use_allowed = 0),
  CHECK ((risk_level IS NULL AND risk_policy_version IS NULL) OR
         (risk_level IN ('LOW', 'MEDIUM', 'HIGH') AND risk_policy_version IS NOT NULL AND risk_policy_status = 'approved')),
  CHECK (research_policy_key = COALESCE(experimental_policy_hash, '')),
  CHECK ((experimental_level IS NULL) = (scoring_api_version = 'v1')),
  CHECK (
    (experimental_level IS NULL AND experimental_label IS NULL AND experimental_status IS NULL AND
     experimental_policy_id IS NULL AND experimental_policy_version IS NULL AND
     experimental_policy_hash IS NULL AND experimental_low_upper_threshold IS NULL AND
     experimental_high_lower_threshold IS NULL AND experimental_boundary_rule IS NULL AND
     experimental_meaning IS NULL AND experimental_score_space IS NULL AND
     experimental_warnings_json IS NULL AND experimental_operational_use_allowed IS NULL)
    OR
    (experimental_level IS NOT NULL AND experimental_label IS NOT NULL AND
     experimental_status IS NOT NULL AND experimental_policy_id IS NOT NULL AND
     experimental_policy_version IS NOT NULL AND experimental_policy_hash IS NOT NULL AND
     experimental_boundary_rule IS NOT NULL AND experimental_meaning IS NOT NULL AND
     experimental_score_space IS NOT NULL AND experimental_warnings_json IS NOT NULL AND
     experimental_operational_use_allowed = 0 AND model_hash_sha256 IS NOT NULL AND
     experimental_low_upper_threshold > 0 AND
     experimental_low_upper_threshold < experimental_high_lower_threshold AND
     experimental_high_lower_threshold < 1)),
  UNIQUE (snapshot_id, model_key, model_version, research_policy_key)
) STRICT;

CREATE INDEX idx_results_snapshot
  ON prediction_model_results (snapshot_id, model_key, scored_at DESC, result_id DESC);
CREATE INDEX idx_results_reservation_model
  ON prediction_model_results (reservation_id, model_key, scored_at DESC, result_id DESC);
CREATE INDEX idx_results_model_policy
  ON prediction_model_results (model_key, research_policy_key, scored_at DESC);

CREATE TRIGGER booking_feature_snapshots_no_update BEFORE UPDATE ON booking_feature_snapshots
BEGIN SELECT RAISE(ABORT, 'booking_feature_snapshots es inmutable'); END;
CREATE TRIGGER booking_feature_snapshots_no_delete BEFORE DELETE ON booking_feature_snapshots
BEGIN SELECT RAISE(ABORT, 'booking_feature_snapshots es inmutable'); END;
CREATE TRIGGER prediction_runs_no_update BEFORE UPDATE ON prediction_runs
BEGIN SELECT RAISE(ABORT, 'prediction_runs es inmutable'); END;
CREATE TRIGGER prediction_runs_no_delete BEFORE DELETE ON prediction_runs
BEGIN SELECT RAISE(ABORT, 'prediction_runs es inmutable'); END;
CREATE TRIGGER prediction_model_results_no_update BEFORE UPDATE ON prediction_model_results
BEGIN SELECT RAISE(ABORT, 'prediction_model_results es inmutable'); END;
CREATE TRIGGER prediction_model_results_no_delete BEFORE DELETE ON prediction_model_results
BEGIN SELECT RAISE(ABORT, 'prediction_model_results es inmutable'); END;
`;

export const PREDICTIVE_STORE_MIGRATIONS: readonly SqliteMigration[] = [
  { version: '001', name: 'local_predictive_store', sql: V001_INITIAL },
];

export const PREDICTIVE_STORE_SCHEMA_VERSION = '001';
