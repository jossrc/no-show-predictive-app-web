-- Sprint 02 · Almacén predictivo PostgreSQL (migración 001, SOLO up)
-- Reemplaza el almacén SQLite local de Sprint 01 (ADR-008). Crea objetos NUEVOS con prefijo
-- ml.app_* en el schema propio ml: no modifica raw_flow, analytics ni objetos preexistentes.
-- Sin IF NOT EXISTS (una colisión debe fallar), sin OR REPLACE, sin DROP/ALTER/DELETE/UPDATE.
-- Ejecutar SOLO con `npm run store:migrate` (rol migrador; nunca el rol runtime).

-- Inmutabilidad de los registros propios: ni UPDATE, ni DELETE, ni TRUNCATE.
CREATE FUNCTION ml.app_prevent_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los registros de %.% son inmutables (%)', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END
$$;

-- Identidad del almacén: una base queda ligada a UN modo de datos (real o sintético).
CREATE TABLE ml.app_predictive_store_identity (
    identity_key     text PRIMARY KEY CHECK (identity_key = 'predictive_store'),
    store_name       text NOT NULL CHECK (store_name = 'no-show-predictive-store'),
    data_source_mode text NOT NULL
                     CHECK (data_source_mode IN ('READ_ONLY_EXISTING_SCHEDULE', 'SYNTHETIC_DEMO_ONLY')),
    bound_at         timestamptz NOT NULL DEFAULT now()
);

-- 1) Snapshot booking_creation inmutable (19 predictoras + evidencia mínima no identificable).
CREATE TABLE ml.app_booking_feature_snapshots (
    snapshot_id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reservation_id            bigint NOT NULL CHECK (reservation_id > 0),
    client_id                 bigint NOT NULL CHECK (client_id > 0),
    snapshot_type             text NOT NULL CHECK (snapshot_type = 'booking_creation'),
    prediction_at             timestamptz NOT NULL,
    appointment_at            timestamptz NOT NULL,
    feature_version           text NOT NULL CHECK (length(feature_version) BETWEEN 1 AND 64),
    builder_version           text NOT NULL CHECK (length(builder_version) BETWEEN 1 AND 64),
    snapshot_hash             char(64) NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
    features                  jsonb NOT NULL CHECK (jsonb_typeof(features) = 'object'),
    evidence_source           text NOT NULL
                              CHECK (evidence_source IN ('VERIFIED_BOOKING_SNAPSHOT', 'SYNTHETIC_DEMO_ONLY')),
    evidence                  jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
    source_ingestion_batch_id text CHECK (source_ingestion_batch_id IS NULL OR length(source_ingestion_batch_id) BETWEEN 1 AND 64),
    created_at                timestamptz NOT NULL,
    legacy_store              text CHECK (legacy_store IN ('sqlite:read_only_existing_schedule', 'sqlite:synthetic_demo_only')),
    legacy_id                 bigint,
    inserted_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_snapshots_prediction_before_appointment CHECK (prediction_at < appointment_at),
    CONSTRAINT app_snapshots_legacy_pair CHECK ((legacy_store IS NULL) = (legacy_id IS NULL)),
    CONSTRAINT app_snapshots_reservation_hash_key UNIQUE (reservation_id, snapshot_hash),
    CONSTRAINT app_snapshots_id_reservation_key UNIQUE (snapshot_id, reservation_id),
    CONSTRAINT app_snapshots_legacy_key UNIQUE (legacy_store, legacy_id)
);

CREATE INDEX app_snapshots_reservation_idx
    ON ml.app_booking_feature_snapshots (reservation_id, evidence_source, created_at DESC, snapshot_id DESC);

-- 2) Ejecución auditable de inferencia solicitada explícitamente (POST /predictions).
CREATE TABLE ml.app_prediction_runs (
    run_id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_uid              uuid NOT NULL,
    snapshot_id          bigint NOT NULL,
    reservation_id       bigint NOT NULL CHECK (reservation_id > 0),
    mode                 text NOT NULL CHECK (mode IN ('single', 'compare')),
    requested_model_keys text[] NOT NULL
                         CHECK (cardinality(requested_model_keys) BETWEEN 1 AND 2
                                AND requested_model_keys <@ ARRAY['random_forest_full_v1', 'xgboost_full_v1']::text[]),
    scoring_api_version  text NOT NULL CHECK (scoring_api_version IN ('v1', 'v2')),
    request_id           text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 64),
    run_requested_at     timestamptz NOT NULL,
    completed_at         timestamptz NOT NULL,
    ml_latency_ms        integer NOT NULL CHECK (ml_latency_ms >= 0),
    legacy_store         text CHECK (legacy_store IN ('sqlite:read_only_existing_schedule', 'sqlite:synthetic_demo_only')),
    legacy_id            bigint,
    inserted_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_runs_legacy_pair CHECK ((legacy_store IS NULL) = (legacy_id IS NULL)),
    CONSTRAINT app_runs_uid_key UNIQUE (run_uid),
    CONSTRAINT app_runs_id_reservation_key UNIQUE (run_id, reservation_id),
    CONSTRAINT app_runs_id_uid_key UNIQUE (run_id, run_uid),
    CONSTRAINT app_runs_legacy_key UNIQUE (legacy_store, legacy_id),
    CONSTRAINT app_runs_snapshot_fk FOREIGN KEY (snapshot_id, reservation_id)
        REFERENCES ml.app_booking_feature_snapshots (snapshot_id, reservation_id)
);

CREATE INDEX app_runs_reservation_idx ON ml.app_prediction_runs (reservation_id, run_id);

-- 3) Resultado por algoritmo y política research (contrato v2 completo, sin redondeos).
CREATE TABLE ml.app_prediction_model_results (
    result_id                            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id                               bigint NOT NULL,
    snapshot_id                          bigint NOT NULL,
    reservation_id                       bigint NOT NULL CHECK (reservation_id > 0),
    model_key                            text NOT NULL CHECK (model_key IN ('random_forest_full_v1', 'xgboost_full_v1')),
    algorithm                            text NOT NULL CHECK (
        (model_key = 'random_forest_full_v1' AND algorithm = 'random_forest') OR
        (model_key = 'xgboost_full_v1' AND algorithm = 'xgboost')),
    model_version                        text NOT NULL CHECK (length(model_version) BETWEEN 1 AND 128),
    model_hash                           text NOT NULL CHECK (length(model_hash) BETWEEN 1 AND 128),
    model_hash_sha256                    char(64) CHECK (model_hash_sha256 IS NULL OR model_hash_sha256 ~ '^[0-9a-f]{64}$'),
    feature_version                      text NOT NULL,
    prediction_at                        timestamptz NOT NULL,
    scored_at                            timestamptz NOT NULL,
    probability_no_show                  double precision NOT NULL
                                         CHECK (probability_no_show >= 0 AND probability_no_show <= 1),
    prediction_target                    text NOT NULL CHECK (prediction_target = 'NO_SHOW_CANDIDATE'),
    validation_status                    text NOT NULL,
    calibration_status                   text NOT NULL,
    operational_use_allowed              boolean NOT NULL CHECK (operational_use_allowed = false),
    risk_level                           text,
    risk_policy_version                  text,
    risk_policy_status                   text NOT NULL CHECK (risk_policy_status IN ('pending_validation', 'approved')),
    scoring_api_version                  text NOT NULL CHECK (scoring_api_version IN ('v1', 'v2')),
    research_policy_key                  text NOT NULL,
    experimental_level                   text CHECK (experimental_level IS NULL OR experimental_level IN ('LOW', 'MEDIUM', 'HIGH')),
    experimental_label                   text,
    experimental_status                  text CHECK (experimental_status IS NULL OR experimental_status = 'RESEARCH_PROVISIONAL'),
    experimental_policy_id               text,
    experimental_policy_version          text,
    experimental_policy_hash             char(64) CHECK (experimental_policy_hash IS NULL OR experimental_policy_hash ~ '^[0-9a-f]{64}$'),
    experimental_low_upper_threshold     double precision,
    experimental_high_lower_threshold    double precision,
    experimental_boundary_rule           text,
    experimental_meaning                 text,
    experimental_score_space             text,
    experimental_warnings                jsonb CHECK (experimental_warnings IS NULL OR jsonb_typeof(experimental_warnings) = 'array'),
    experimental_approved_by             text CHECK (experimental_approved_by IS NULL),
    experimental_operational_use_allowed boolean CHECK (experimental_operational_use_allowed IS NULL OR experimental_operational_use_allowed = false),
    legacy_store                         text CHECK (legacy_store IN ('sqlite:read_only_existing_schedule', 'sqlite:synthetic_demo_only')),
    legacy_id                            bigint,
    inserted_at                          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_results_legacy_pair CHECK ((legacy_store IS NULL) = (legacy_id IS NULL)),
    CONSTRAINT app_results_operational_level CHECK (
        (risk_level IS NULL AND risk_policy_version IS NULL) OR
        (risk_level IN ('LOW', 'MEDIUM', 'HIGH') AND risk_policy_version IS NOT NULL AND risk_policy_status = 'approved')),
    CONSTRAINT app_results_policy_key CHECK (research_policy_key = COALESCE(experimental_policy_hash, '')),
    CONSTRAINT app_results_band_by_api CHECK ((experimental_level IS NULL) = (scoring_api_version = 'v1')),
    CONSTRAINT app_results_band_all_or_nothing CHECK (
        (experimental_level IS NULL AND experimental_label IS NULL AND experimental_status IS NULL AND
         experimental_policy_id IS NULL AND experimental_policy_version IS NULL AND
         experimental_policy_hash IS NULL AND experimental_low_upper_threshold IS NULL AND
         experimental_high_lower_threshold IS NULL AND experimental_boundary_rule IS NULL AND
         experimental_meaning IS NULL AND experimental_score_space IS NULL AND
         experimental_warnings IS NULL AND experimental_operational_use_allowed IS NULL)
        OR
        (experimental_level IS NOT NULL AND experimental_label IS NOT NULL AND
         experimental_status IS NOT NULL AND experimental_policy_id IS NOT NULL AND
         experimental_policy_version IS NOT NULL AND experimental_policy_hash IS NOT NULL AND
         experimental_boundary_rule IS NOT NULL AND experimental_meaning IS NOT NULL AND
         experimental_score_space IS NOT NULL AND experimental_warnings IS NOT NULL AND
         experimental_operational_use_allowed = false AND model_hash_sha256 IS NOT NULL AND
         experimental_low_upper_threshold > 0 AND
         experimental_low_upper_threshold < experimental_high_lower_threshold AND
         experimental_high_lower_threshold < 1)),
    CONSTRAINT app_results_identity_key UNIQUE (snapshot_id, model_key, model_version, research_policy_key),
    CONSTRAINT app_results_link_key UNIQUE (result_id, run_id, reservation_id, model_key),
    CONSTRAINT app_results_legacy_key UNIQUE (legacy_store, legacy_id),
    CONSTRAINT app_results_run_fk FOREIGN KEY (run_id, reservation_id)
        REFERENCES ml.app_prediction_runs (run_id, reservation_id),
    CONSTRAINT app_results_snapshot_fk FOREIGN KEY (snapshot_id, reservation_id)
        REFERENCES ml.app_booking_feature_snapshots (snapshot_id, reservation_id)
);

CREATE INDEX app_results_snapshot_idx
    ON ml.app_prediction_model_results (snapshot_id, model_key, scored_at DESC, result_id DESC);
CREATE INDEX app_results_reservation_model_idx
    ON ml.app_prediction_model_results (reservation_id, model_key, scored_at DESC, result_id DESC);
CREATE INDEX app_results_model_policy_idx
    ON ml.app_prediction_model_results (model_key, research_policy_key, scored_at DESC);
CREATE INDEX app_results_run_idx ON ml.app_prediction_model_results (run_id);

CREATE TRIGGER app_identity_immutable BEFORE UPDATE OR DELETE ON ml.app_predictive_store_identity
    FOR EACH ROW EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_identity_no_truncate BEFORE TRUNCATE ON ml.app_predictive_store_identity
    FOR EACH STATEMENT EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_snapshots_immutable BEFORE UPDATE OR DELETE ON ml.app_booking_feature_snapshots
    FOR EACH ROW EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_snapshots_no_truncate BEFORE TRUNCATE ON ml.app_booking_feature_snapshots
    FOR EACH STATEMENT EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_runs_immutable BEFORE UPDATE OR DELETE ON ml.app_prediction_runs
    FOR EACH ROW EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_runs_no_truncate BEFORE TRUNCATE ON ml.app_prediction_runs
    FOR EACH STATEMENT EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_results_immutable BEFORE UPDATE OR DELETE ON ml.app_prediction_model_results
    FOR EACH ROW EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_results_no_truncate BEFORE TRUNCATE ON ml.app_prediction_model_results
    FOR EACH STATEMENT EXECUTE FUNCTION ml.app_prevent_mutation();

COMMENT ON TABLE ml.app_booking_feature_snapshots IS
  'Sprint 02 (ADR-008): snapshot booking_creation inmutable; sustituye al SQLite local de Sprint 01.';
COMMENT ON TABLE ml.app_prediction_model_results IS
  'Score exploratorio por algoritmo con banda experimental research v2 (RESEARCH_PROVISIONAL). No es riesgo operativo.';
