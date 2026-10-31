-- TESIS 2026-2027 · Sprint 01 · Migración app 001 (UP)
-- Almacén predictivo PROPIEDAD DE LA APP en el schema ml (creado vacío por docker/postgres/init).
-- Aditiva e idempotente: NO modifica raw_flow ni analytics; NO crea usuarios/roles/campañas.
-- Ejecutar con `npm run migrate:app` (primero `-- --dry-run`). Nunca al arrancar el servidor.

CREATE SCHEMA IF NOT EXISTS ml;

-- Inmutabilidad: snapshots, runs y resultados son registros predictivos auditables.
CREATE OR REPLACE FUNCTION ml.prevent_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los registros de %.% son inmutables', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END
$$;

-- 1) Instantánea booking_creation con evidencia temporal verdadera (o sintética en BD de prueba).
CREATE TABLE IF NOT EXISTS ml.booking_feature_snapshots (
    snapshot_id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reservation_id            bigint NOT NULL CHECK (reservation_id > 0),
    client_id                 bigint NOT NULL CHECK (client_id > 0),
    snapshot_type             text NOT NULL CHECK (snapshot_type = 'booking_creation'),
    prediction_at             timestamptz NOT NULL,
    appointment_at            timestamptz NOT NULL,
    feature_version           text NOT NULL CHECK (length(feature_version) BETWEEN 1 AND 64),
    builder_version           text NOT NULL CHECK (builder_version ~ '^[A-Za-z0-9._-]{1,64}$'),
    snapshot_hash             char(64) NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
    features                  jsonb NOT NULL CHECK (jsonb_typeof(features) = 'object'),
    evidence_source           text NOT NULL
                              CHECK (evidence_source IN ('VERIFIED_BOOKING_SNAPSHOT', 'SYNTHETIC_DEMO_ONLY')),
    evidence                  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
    source_ingestion_batch_id bigint,
    created_at                timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT booking_feature_snapshots_prediction_before_appointment
        CHECK (prediction_at < appointment_at),
    CONSTRAINT booking_feature_snapshots_reservation_hash_key UNIQUE (reservation_id, snapshot_hash)
);

COMMENT ON TABLE ml.booking_feature_snapshots IS
  'Snapshot inmutable de las 19 predictoras al crear la reserva. Solo evidencia temporal demostrable.';
COMMENT ON COLUMN ml.booking_feature_snapshots.features IS
  'Exactamente las 19 predictoras BOOKING_BASELINE_V1 (sin IDs, target ni PII directa). Necesarias para SHAP reproducible.';

CREATE INDEX IF NOT EXISTS idx_booking_snapshots_reservation_created
    ON ml.booking_feature_snapshots (reservation_id, created_at DESC, snapshot_id DESC);

CREATE OR REPLACE TRIGGER trg_booking_snapshots_immutable
    BEFORE UPDATE ON ml.booking_feature_snapshots
    FOR EACH ROW EXECUTE FUNCTION ml.prevent_mutation();

-- 2) Ejecución auditable de inferencia solicitada explícitamente (POST).
CREATE TABLE IF NOT EXISTS ml.prediction_runs (
    run_id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_uid              uuid NOT NULL UNIQUE,
    snapshot_id          bigint NOT NULL REFERENCES ml.booking_feature_snapshots (snapshot_id) ON DELETE RESTRICT,
    reservation_id       bigint NOT NULL CHECK (reservation_id > 0),
    mode                 text NOT NULL CHECK (mode IN ('single', 'compare')),
    requested_model_keys text[] NOT NULL CHECK (cardinality(requested_model_keys) BETWEEN 1 AND 2),
    request_id           text NOT NULL CHECK (request_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
    run_requested_at     timestamptz NOT NULL,
    completed_at         timestamptz NOT NULL,
    ml_latency_ms        integer NOT NULL CHECK (ml_latency_ms >= 0),
    created_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT prediction_runs_completed_after_request CHECK (completed_at >= run_requested_at)
);

CREATE INDEX IF NOT EXISTS idx_prediction_runs_snapshot ON ml.prediction_runs (snapshot_id);

CREATE OR REPLACE TRIGGER trg_prediction_runs_immutable
    BEFORE UPDATE ON ml.prediction_runs
    FOR EACH ROW EXECUTE FUNCTION ml.prevent_mutation();

-- 3) Un resultado por modelo/versión/snapshot. Probabilidad original sin redondeo.
CREATE TABLE IF NOT EXISTS ml.prediction_model_results (
    result_id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id                  bigint NOT NULL REFERENCES ml.prediction_runs (run_id) ON DELETE RESTRICT,
    snapshot_id             bigint NOT NULL REFERENCES ml.booking_feature_snapshots (snapshot_id) ON DELETE RESTRICT,
    reservation_id          bigint NOT NULL CHECK (reservation_id > 0),
    model_key               text NOT NULL CHECK (model_key ~ '^[a-z0-9_]{1,64}$'),
    algorithm               text NOT NULL CHECK (algorithm IN ('random_forest', 'xgboost')),
    model_version           text NOT NULL CHECK (length(model_version) BETWEEN 1 AND 128),
    model_hash              text NOT NULL CHECK (model_hash ~ '^[0-9a-f]{6,64}$'),
    feature_version         text NOT NULL,
    prediction_at           timestamptz NOT NULL,
    scored_at               timestamptz NOT NULL,
    probability_no_show     double precision NOT NULL
                            CHECK (probability_no_show >= 0 AND probability_no_show <= 1),
    prediction_target       text NOT NULL CHECK (prediction_target = 'NO_SHOW_CANDIDATE'),
    validation_status       text NOT NULL,
    calibration_status      text NOT NULL,
    -- Sin release científico aprobado no puede habilitarse uso operativo (requiere migración nueva).
    operational_use_allowed boolean NOT NULL DEFAULT false CHECK (operational_use_allowed = false),
    -- Sin DEFAULT 'LOW': el nivel solo existe con una política versionada y aprobada.
    risk_level              text CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
    risk_policy_version     text,
    risk_policy_status      text NOT NULL DEFAULT 'pending_validation'
                            CHECK (risk_policy_status IN ('pending_validation', 'approved')),
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT prediction_model_results_level_requires_policy
        CHECK ((risk_level IS NULL) = (risk_policy_version IS NULL)),
    CONSTRAINT prediction_model_results_level_requires_approval
        CHECK (risk_level IS NULL OR risk_policy_status = 'approved'),
    CONSTRAINT prediction_model_results_identity_key UNIQUE (snapshot_id, model_key, model_version)
);

COMMENT ON TABLE ml.prediction_model_results IS
  'Score exploratorio por algoritmo (EXPLORATORY_NOT_VALIDATED). No es nivel de riesgo operativo.';

CREATE INDEX IF NOT EXISTS idx_prediction_results_reservation_model
    ON ml.prediction_model_results (reservation_id, model_key, scored_at DESC, result_id DESC);
CREATE INDEX IF NOT EXISTS idx_prediction_results_run ON ml.prediction_model_results (run_id);

CREATE OR REPLACE TRIGGER trg_prediction_results_immutable
    BEFORE UPDATE ON ml.prediction_model_results
    FOR EACH ROW EXECUTE FUNCTION ml.prevent_mutation();
