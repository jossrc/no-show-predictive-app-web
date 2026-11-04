-- TESIS 2026-2027 · Sprint 02 · Optimización operativa HU-06/HU-07/HU-08 (migración 002, SOLO up)
-- Registros de gestión PROPIOS de la app: nunca modifican la reserva en FLOWww (raw_flow/analytics).
-- reservation_id/clinic_id referencian lógicamente la fuente; las FK físicas solo apuntan a ml.app_*.
-- Inmutables (sin UPDATE/DELETE/TRUNCATE): una corrección formal queda fuera del Sprint 02.

-- HU-06: marca manual «Habilitado para sobreasignación» (una por reserva, sin revocación).
CREATE TABLE ml.app_overbooking_authorizations (
    authorization_id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reservation_id                       bigint NOT NULL CHECK (reservation_id > 0),
    clinic_id                            integer NOT NULL CHECK (clinic_id > 0),
    appointment_at                       timestamptz NOT NULL,
    status                               text NOT NULL CHECK (status = 'ENABLED'),
    enabled_at                           timestamptz NOT NULL,
    request_id                           text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 64),
    actor_kind                           text NOT NULL CHECK (actor_kind = 'INTERNAL_SERVICE'),
    actor_user_id                        text CHECK (actor_user_id IS NULL),
    prediction_run_id                    bigint NOT NULL,
    prediction_run_uid                   uuid NOT NULL,
    prediction_result_id                 bigint NOT NULL,
    model_key                            text NOT NULL CHECK (model_key IN ('random_forest_full_v1', 'xgboost_full_v1')),
    model_version                        text NOT NULL,
    research_policy_hash                 char(64) NOT NULL CHECK (research_policy_hash ~ '^[0-9a-f]{64}$'),
    research_policy_version              text NOT NULL,
    risk_band_at_authorization           text NOT NULL CHECK (risk_band_at_authorization = 'HIGH'),
    probability_no_show_at_authorization double precision NOT NULL
                                         CHECK (probability_no_show_at_authorization >= 0 AND probability_no_show_at_authorization <= 1),
    scored_at                            timestamptz NOT NULL,
    eligibility_rule_version             text NOT NULL CHECK (eligibility_rule_version = 'overbooking_eligibility_v1'),
    inserted_at                          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_overbooking_enabled_before_appointment CHECK (enabled_at < appointment_at),
    CONSTRAINT app_overbooking_reservation_key UNIQUE (reservation_id),
    CONSTRAINT app_overbooking_id_reservation_key UNIQUE (authorization_id, reservation_id),
    CONSTRAINT app_overbooking_result_fk FOREIGN KEY (prediction_result_id, prediction_run_id, reservation_id, model_key)
        REFERENCES ml.app_prediction_model_results (result_id, run_id, reservation_id, model_key),
    CONSTRAINT app_overbooking_run_fk FOREIGN KEY (prediction_run_id, prediction_run_uid)
        REFERENCES ml.app_prediction_runs (run_id, run_uid)
);

CREATE INDEX app_overbooking_appointment_idx
    ON ml.app_overbooking_authorizations (appointment_at, reservation_id);
CREATE INDEX app_overbooking_clinic_appointment_idx
    ON ml.app_overbooking_authorizations (clinic_id, appointment_at, reservation_id);

-- HU-07: resultado REAL observado (asistió / no asistió), vinculado a un run previo de la reserva.
CREATE TABLE ml.app_attendance_outcomes (
    attendance_outcome_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reservation_id            bigint NOT NULL CHECK (reservation_id > 0),
    clinic_id                 integer NOT NULL CHECK (clinic_id > 0),
    appointment_at            timestamptz NOT NULL,
    appointment_end_at        timestamptz,
    source_reservation_status text NOT NULL CHECK (source_reservation_status IN ('SCHEDULED', 'PAST')),
    attendance_status         text NOT NULL CHECK (attendance_status IN ('ATTENDED', 'NO_SHOW')),
    observed_no_show          boolean NOT NULL,
    recorded_at               timestamptz NOT NULL,
    request_id                text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 64),
    actor_kind                text NOT NULL CHECK (actor_kind = 'INTERNAL_SERVICE'),
    actor_user_id             text CHECK (actor_user_id IS NULL),
    prediction_run_id         bigint NOT NULL,
    prediction_run_uid        uuid NOT NULL,
    finished_rule_version     text NOT NULL CHECK (finished_rule_version = 'appointment_finished_rule_v1'),
    inserted_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_attendance_observed CHECK (observed_no_show = (attendance_status = 'NO_SHOW')),
    CONSTRAINT app_attendance_after_appointment CHECK (recorded_at > appointment_at),
    CONSTRAINT app_attendance_reservation_key UNIQUE (reservation_id),
    CONSTRAINT app_attendance_link_key UNIQUE (attendance_outcome_id, prediction_run_id, reservation_id),
    CONSTRAINT app_attendance_run_fk FOREIGN KEY (prediction_run_id, reservation_id)
        REFERENCES ml.app_prediction_runs (run_id, reservation_id),
    CONSTRAINT app_attendance_run_uid_fk FOREIGN KEY (prediction_run_id, prediction_run_uid)
        REFERENCES ml.app_prediction_runs (run_id, run_uid)
);

CREATE INDEX app_attendance_appointment_idx
    ON ml.app_attendance_outcomes (appointment_at, reservation_id);
CREATE INDEX app_attendance_clinic_appointment_idx
    ON ml.app_attendance_outcomes (clinic_id, appointment_at, reservation_id);

-- HU-07: comparación descriptiva POR MODELO (RF y XGB por separado; sin ensemble ni ganador).
CREATE TABLE ml.app_attendance_prediction_comparisons (
    comparison_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    attendance_outcome_id   bigint NOT NULL,
    reservation_id          bigint NOT NULL CHECK (reservation_id > 0),
    prediction_run_id       bigint NOT NULL,
    prediction_result_id    bigint NOT NULL,
    model_key               text NOT NULL CHECK (model_key IN ('random_forest_full_v1', 'xgboost_full_v1')),
    model_version           text NOT NULL,
    probability_no_show     double precision NOT NULL CHECK (probability_no_show >= 0 AND probability_no_show <= 1),
    scored_at               timestamptz NOT NULL,
    experimental_risk_level text CHECK (experimental_risk_level IS NULL OR experimental_risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
    research_policy_hash    char(64) CHECK (research_policy_hash IS NULL OR research_policy_hash ~ '^[0-9a-f]{64}$'),
    comparison_rule_version text NOT NULL CHECK (comparison_rule_version = 'binary_outcome_threshold_v1'),
    threshold               double precision NOT NULL CHECK (threshold > 0 AND threshold < 1),
    predicted_no_show       boolean NOT NULL,
    observed_no_show        boolean NOT NULL,
    matches_prediction      boolean NOT NULL,
    inserted_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_comparisons_predicted CHECK (predicted_no_show = (probability_no_show >= threshold)),
    CONSTRAINT app_comparisons_matches CHECK (matches_prediction = (predicted_no_show = observed_no_show)),
    CONSTRAINT app_comparisons_result_key UNIQUE (attendance_outcome_id, prediction_result_id),
    CONSTRAINT app_comparisons_model_key UNIQUE (attendance_outcome_id, model_key),
    CONSTRAINT app_comparisons_outcome_fk FOREIGN KEY (attendance_outcome_id, prediction_run_id, reservation_id)
        REFERENCES ml.app_attendance_outcomes (attendance_outcome_id, prediction_run_id, reservation_id),
    CONSTRAINT app_comparisons_result_fk FOREIGN KEY (prediction_result_id, prediction_run_id, reservation_id, model_key)
        REFERENCES ml.app_prediction_model_results (result_id, run_id, reservation_id, model_key)
);

-- HU-08: resultado operativo explícito de la gestión preventiva (true/false; ausencia = sin registro).
CREATE TABLE ml.app_space_recovery_outcomes (
    recovery_outcome_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    authorization_id    bigint NOT NULL,
    reservation_id      bigint NOT NULL CHECK (reservation_id > 0),
    clinic_id           integer NOT NULL CHECK (clinic_id > 0),
    appointment_at      timestamptz NOT NULL,
    space_recovered     boolean NOT NULL,
    recorded_at         timestamptz NOT NULL,
    request_id          text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 64),
    actor_kind          text NOT NULL CHECK (actor_kind = 'INTERNAL_SERVICE'),
    actor_user_id       text CHECK (actor_user_id IS NULL),
    inserted_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_recovery_authorization_key UNIQUE (authorization_id),
    CONSTRAINT app_recovery_reservation_key UNIQUE (reservation_id),
    CONSTRAINT app_recovery_authorization_fk FOREIGN KEY (authorization_id, reservation_id)
        REFERENCES ml.app_overbooking_authorizations (authorization_id, reservation_id)
);

CREATE INDEX app_recovery_appointment_idx
    ON ml.app_space_recovery_outcomes (appointment_at, reservation_id);
CREATE INDEX app_recovery_clinic_appointment_idx
    ON ml.app_space_recovery_outcomes (clinic_id, appointment_at, reservation_id);

CREATE TRIGGER app_overbooking_immutable BEFORE UPDATE OR DELETE ON ml.app_overbooking_authorizations
    FOR EACH ROW EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_overbooking_no_truncate BEFORE TRUNCATE ON ml.app_overbooking_authorizations
    FOR EACH STATEMENT EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_attendance_immutable BEFORE UPDATE OR DELETE ON ml.app_attendance_outcomes
    FOR EACH ROW EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_attendance_no_truncate BEFORE TRUNCATE ON ml.app_attendance_outcomes
    FOR EACH STATEMENT EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_comparisons_immutable BEFORE UPDATE OR DELETE ON ml.app_attendance_prediction_comparisons
    FOR EACH ROW EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_comparisons_no_truncate BEFORE TRUNCATE ON ml.app_attendance_prediction_comparisons
    FOR EACH STATEMENT EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_recovery_immutable BEFORE UPDATE OR DELETE ON ml.app_space_recovery_outcomes
    FOR EACH ROW EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_recovery_no_truncate BEFORE TRUNCATE ON ml.app_space_recovery_outcomes
    FOR EACH STATEMENT EXECUTE FUNCTION ml.app_prevent_mutation();

COMMENT ON TABLE ml.app_overbooking_authorizations IS
  'HU-06: autorización manual para análisis de sobreasignación. No crea citas ni modifica FLOWww.';
COMMENT ON TABLE ml.app_attendance_outcomes IS
  'HU-07: asistencia observada registrada explícitamente; no es una predicción ni se infiere.';
COMMENT ON TABLE ml.app_space_recovery_outcomes IS
  'HU-08: espacio recuperado Sí/No tras una gestión HU-06 previa. false = gestionado sin recuperar.';
