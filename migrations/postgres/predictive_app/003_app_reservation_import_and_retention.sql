-- Migración 003 (SOLO up): incorporación masiva de reservas y gestión de retención.
-- Objetos NUEVOS ml.app_* propiedad de la app: no modifica raw_flow, analytics ni tablas previas.
-- Sin IF NOT EXISTS, sin OR REPLACE, sin DROP/ALTER/DELETE/UPDATE. Registros inmutables.
-- Ejecutar SOLO con `npm run store:migrate` (rol migrador) y con autorización del propietario.

-- Lote de importación: un registro por archivo procesado (el archivo original NO se almacena).
CREATE TABLE ml.app_reservation_import_batches (
    batch_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_uid        uuid NOT NULL,
    contract_version text NOT NULL CHECK (contract_version = 'reservation_import_v1'),
    file_format      text NOT NULL CHECK (file_format IN ('CSV', 'XLSX')),
    file_sha256      char(64) NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
    file_size_bytes  integer NOT NULL CHECK (file_size_bytes > 0),
    status           text NOT NULL
                     CHECK (status IN ('COMPLETED', 'COMPLETED_WITH_REJECTIONS', 'NO_ROWS_ACCEPTED')),
    processed_at     timestamptz NOT NULL,
    total_rows       integer NOT NULL CHECK (total_rows > 0),
    accepted_rows    integer NOT NULL CHECK (accepted_rows >= 0),
    rejected_rows    integer NOT NULL CHECK (rejected_rows >= 0),
    request_id       text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 64),
    actor_kind       text NOT NULL CHECK (actor_kind = 'INTERNAL_SERVICE'),
    actor_user_id    text CHECK (actor_user_id IS NULL),
    inserted_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_import_batches_counts CHECK (total_rows = accepted_rows + rejected_rows),
    CONSTRAINT app_import_batches_status CHECK (
        (status = 'COMPLETED') = (rejected_rows = 0) AND
        (status = 'NO_ROWS_ACCEPTED') = (accepted_rows = 0)),
    CONSTRAINT app_import_batches_uid_key UNIQUE (batch_uid)
);

CREATE INDEX app_import_batches_processed_idx
    ON ml.app_reservation_import_batches (processed_at DESC, batch_id DESC);

-- Reserva incorporada desde un archivo. UNIQUE (reservation_id) garantiza idempotencia: una
-- reimportación nunca duplica ni reemplaza el registro original. Las FK hacia el lote son
-- diferidas porque los conteos del lote se conocen al final de la misma transacción.
CREATE TABLE ml.app_imported_reservations (
    imported_reservation_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reservation_id           bigint NOT NULL CHECK (reservation_id > 0),
    batch_uid                uuid NOT NULL,
    row_number               integer NOT NULL CHECK (row_number >= 2),
    client_id                bigint NOT NULL CHECK (client_id > 0),
    clinic_id                integer NOT NULL CHECK (clinic_id > 0),
    appointment_at           timestamptz NOT NULL,
    appointment_end_at       timestamptz,
    booking_created_at       timestamptz NOT NULL,
    reservation_status       text NOT NULL CHECK (reservation_status IN ('SCHEDULED', 'CANCELLED')),
    fwa_flag                 smallint CHECK (fwa_flag IS NULL OR fwa_flag IN (0, -1)),
    reschedule_count         integer NOT NULL CHECK (reschedule_count >= 0),
    service_product_ids      bigint[] NOT NULL CHECK (
        cardinality(service_product_ids) BETWEEN 1 AND 50 AND
        array_position(service_product_ids, NULL) IS NULL AND
        0 < ALL (service_product_ids)),
    row_hash                 char(64) NOT NULL CHECK (row_hash ~ '^[0-9a-f]{64}$'),
    classification_cutoff_at timestamptz NOT NULL,
    inserted_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_imported_booking_before_appointment CHECK (booking_created_at < appointment_at),
    CONSTRAINT app_imported_end_after_start
        CHECK (appointment_end_at IS NULL OR appointment_end_at >= appointment_at),
    CONSTRAINT app_imported_classification_cutoff CHECK (
        booking_created_at <= classification_cutoff_at AND appointment_at > classification_cutoff_at),
    CONSTRAINT app_imported_reservation_key UNIQUE (reservation_id),
    CONSTRAINT app_imported_batch_row_key UNIQUE (batch_uid, row_number),
    CONSTRAINT app_imported_batch_fk FOREIGN KEY (batch_uid)
        REFERENCES ml.app_reservation_import_batches (batch_uid) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX app_imported_appointment_idx
    ON ml.app_imported_reservations (appointment_at, reservation_id);
CREATE INDEX app_imported_status_appointment_idx
    ON ml.app_imported_reservations (reservation_status, appointment_at, reservation_id);
CREATE INDEX app_imported_clinic_appointment_idx
    ON ml.app_imported_reservations (clinic_id, appointment_at, reservation_id);

-- Motivos de rechazo por fila: solo códigos, campo y fila (nunca el valor recibido).
CREATE TABLE ml.app_reservation_import_rejections (
    rejection_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_uid      uuid NOT NULL,
    row_number     integer NOT NULL CHECK (row_number >= 2),
    reservation_id bigint CHECK (reservation_id IS NULL OR reservation_id > 0),
    reason_code    text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
    field          text CHECK (field IS NULL OR field ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
    inserted_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_import_rejections_reason_key
        UNIQUE NULLS NOT DISTINCT (batch_uid, row_number, reason_code, field),
    CONSTRAINT app_import_rejections_batch_fk FOREIGN KEY (batch_uid)
        REFERENCES ml.app_reservation_import_batches (batch_uid) DEFERRABLE INITIALLY DEFERRED
);

-- Acción de retención registrada (no envía mensajes). Unidad de gestión: la reserva.
CREATE TABLE ml.app_retention_contacts (
    contact_id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reservation_id                 bigint NOT NULL CHECK (reservation_id > 0),
    client_id                      bigint NOT NULL CHECK (client_id > 0),
    clinic_id                      integer NOT NULL CHECK (clinic_id > 0),
    appointment_at                 timestamptz NOT NULL,
    retention_status               text NOT NULL CHECK (retention_status = 'CAMPAIGN_SENT'),
    contacted_at                   timestamptz NOT NULL,
    request_id                     text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 64),
    actor_kind                     text NOT NULL CHECK (actor_kind = 'INTERNAL_SERVICE'),
    actor_user_id                  text CHECK (actor_user_id IS NULL),
    prediction_run_id              bigint NOT NULL,
    prediction_run_uid             uuid NOT NULL,
    prediction_result_id           bigint NOT NULL,
    model_key                      text NOT NULL CHECK (model_key IN ('random_forest_full_v1', 'xgboost_full_v1')),
    model_version                  text NOT NULL,
    research_policy_hash           char(64) NOT NULL CHECK (research_policy_hash ~ '^[0-9a-f]{64}$'),
    research_policy_version        text NOT NULL,
    risk_band_at_contact           text NOT NULL CHECK (risk_band_at_contact = 'HIGH'),
    probability_no_show_at_contact double precision NOT NULL
                                   CHECK (probability_no_show_at_contact >= 0 AND probability_no_show_at_contact <= 1),
    scored_at                      timestamptz NOT NULL,
    eligibility_rule_version       text NOT NULL CHECK (eligibility_rule_version = 'retention_priority_v1'),
    inserted_at                    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_retention_contact_before_appointment CHECK (contacted_at < appointment_at),
    CONSTRAINT app_retention_reservation_key UNIQUE (reservation_id),
    CONSTRAINT app_retention_result_fk FOREIGN KEY (prediction_result_id, prediction_run_id, reservation_id, model_key)
        REFERENCES ml.app_prediction_model_results (result_id, run_id, reservation_id, model_key),
    CONSTRAINT app_retention_run_fk FOREIGN KEY (prediction_run_id, prediction_run_uid)
        REFERENCES ml.app_prediction_runs (run_id, run_uid)
);

CREATE INDEX app_retention_appointment_idx
    ON ml.app_retention_contacts (appointment_at, reservation_id);

CREATE TRIGGER app_import_batches_immutable BEFORE UPDATE OR DELETE ON ml.app_reservation_import_batches
    FOR EACH ROW EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_import_batches_no_truncate BEFORE TRUNCATE ON ml.app_reservation_import_batches
    FOR EACH STATEMENT EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_imported_immutable BEFORE UPDATE OR DELETE ON ml.app_imported_reservations
    FOR EACH ROW EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_imported_no_truncate BEFORE TRUNCATE ON ml.app_imported_reservations
    FOR EACH STATEMENT EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_import_rejections_immutable BEFORE UPDATE OR DELETE ON ml.app_reservation_import_rejections
    FOR EACH ROW EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_import_rejections_no_truncate BEFORE TRUNCATE ON ml.app_reservation_import_rejections
    FOR EACH STATEMENT EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_retention_immutable BEFORE UPDATE OR DELETE ON ml.app_retention_contacts
    FOR EACH ROW EXECUTE FUNCTION ml.app_prevent_mutation();
CREATE TRIGGER app_retention_no_truncate BEFORE TRUNCATE ON ml.app_retention_contacts
    FOR EACH STATEMENT EXECUTE FUNCTION ml.app_prevent_mutation();

COMMENT ON TABLE ml.app_reservation_import_batches IS
  'Lote de importación de reservas (CSV/XLSX): trazabilidad y conteos. El archivo original no se guarda.';
COMMENT ON TABLE ml.app_imported_reservations IS
  'Reserva incorporada desde un archivo del sistema de agendamiento. No modifica raw_flow/analytics.';
COMMENT ON TABLE ml.app_reservation_import_rejections IS
  'Motivo de rechazo por fila de un lote (código y campo; sin valores personales).';
COMMENT ON TABLE ml.app_retention_contacts IS
  'Acción de retención registrada por reserva (no envía comunicaciones). Inmutable.';
