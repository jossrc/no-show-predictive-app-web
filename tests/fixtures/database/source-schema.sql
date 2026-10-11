-- FIXTURE DE ESTRUCTURA (sin datos) para la BD de PRUEBA aislada.
-- Generado desde bd/raw_flow.sql y bd/analytics.sql (DDL exportado del esquema real, 2026-10-10):
-- solo tablas/tipos/índices que lee el Sprint 01 + laser_gen (ETL 13 de paridad).
-- Se omiten owners. Nunca se ejecuta contra la base real (TestDatabase lo impide).
CREATE SCHEMA IF NOT EXISTS raw_flow;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS ml;

SET search_path TO raw_flow;
create table ingestion_batches
(
    batch_id        bigint generated always as identity
        primary key,
    source_type     text                                             not null
        constraint ingestion_batches_source_type_check
            check (source_type = ANY (ARRAY ['DIRECT_MYSQL'::text, 'CSV'::text])),
    source_name     text,
    dataset_date    date,
    started_at      timestamp with time zone default now()           not null,
    finished_at     timestamp with time zone,
    status          text                     default 'RUNNING'::text not null
        constraint ingestion_batches_status_check
            check (status = ANY (ARRAY ['RUNNING'::text, 'COMPLETED'::text, 'FAILED'::text, 'PARTIAL'::text])),
    row_counts      jsonb                    default '{}'::jsonb     not null,
    checksum_sha256 text,
    notes           text,
    error_message   text
);

create table x_config_clinics
(
    "ClinicID"             integer                                                not null
        primary key,
    "ClinicName"           varchar(128)             default ''::character varying not null,
    "ClinicCommercialName" varchar(128)             default ''::character varying not null,
    "ClinicTimeStart"      time,
    "ClinicTimeEnd"        time,
    "ClinicSAT"            smallint                 default 0                     not null,
    "ClinicSATTimeStart"   time,
    "ClinicSATTimeEnd"     time,
    "ClinicSUN"            smallint                 default 0                     not null,
    "ClinicAppConcurrent"  smallint                 default 0                     not null,
    "ClinicCity"           varchar(64)              default ''::character varying not null,
    "ClinicProvinceID"     bigint                   default 0                     not null,
    "ClinicRegionID"       smallint                 default 0                     not null,
    "ClinicCountryID"      smallint                 default 0                     not null,
    "ClinicTimeZoneID"     integer                  default 0                     not null,
    "ClinicProductGID"     bigint                   default 0                     not null,
    "ClinicStatsDisabled"  smallint                 default 0                     not null,
    "ClinicDisabled"       smallint                 default 0                     not null,
    "ClinicReadOnly"       smallint                 default 0                     not null,
    "ClinicTest"           smallint                 default 0                     not null,
    "ClinicStopped"        smallint                 default 0                     not null,
    "ClinicStandBy"        smallint                 default 0                     not null,
    "ClinicDateNew"        date,
    "ClinicDateDisabled"   date,
    "ClinicStamp"          timestamp,
    _ingested_at           timestamp with time zone default now()                 not null,
    _ingestion_batch_id    bigint
        references ingestion_batches
);

create table x_config_products_det
(
    "ProductID"                    bigint                                                 not null
        primary key,
    "ProductParentID"              bigint                   default 0                     not null,
    "ProductSourceID"              bigint                   default 0                     not null,
    "ProductGID"                   bigint                   default 0                     not null,
    "ProductFamilyID"              bigint                   default 0                     not null,
    "ProductZoneClassID"           bigint,
    "ProductZoneCode"              varchar(16),
    "ProductDesc"                  varchar(128)             default ''::character varying not null,
    "ProductPrice"                 numeric(14, 2)           default 0                     not null,
    "ProductPromotedPrice"         numeric(14, 2)           default 0                     not null,
    "ProductVAT"                   numeric(6, 6)            default 0                     not null,
    "ProductCostPrice"             numeric(14, 2)           default 0                     not null,
    "ProductType"                  smallint                 default 0                     not null,
    "ProductExpiryDate"            integer                  default 0                     not null,
    "ProductColourID"              smallint                 default 0                     not null,
    "ProductSlots"                 smallint                 default 0                     not null,
    "ProductVoucherUnits"          bigint                   default 0                     not null,
    "ProductVoucherUnitClassID"    smallint                 default 1                     not null,
    "ProductVoucherZCID"           bigint,
    "ProductVoucherPID"            bigint,
    "ProductVoucherNum"            bigint,
    "ProductVoucherExpiryInterval" text                     default ''::text              not null,
    "ProductVoucherExpiryUnits"    integer                  default 0                     not null,
    "ProductVoucherExpiryDate"     date,
    "ProductVoucherVariable"       smallint                 default 0                     not null,
    "ProductVoucherDepositPcnt"    numeric(7, 6),
    "ProductShotsMin"              integer                  default 0                     not null,
    "ProductShotsMax"              integer                  default 0                     not null,
    "ProductTimerMin"              integer                  default 0                     not null,
    "ProductTimerMax"              integer                  default 0                     not null,
    "ProductRequiresDoctor"        smallint                 default 0                     not null,
    "ProductStatsDisabled"         smallint                 default 0                     not null,
    "ProductFWAEnabled"            smallint                 default 0                     not null,
    "ProductSchedAndBuy"           smallint                 default 0                     not null,
    "ProductEvaluation"            smallint                 default 0                     not null,
    "ProductCabinets"              varchar(5000)            default ''::character varying not null,
    "ProductEquipmentID"           bigint                   default 0                     not null,
    "ProductDisabled"              smallint                 default 0                     not null,
    "ProductStamp"                 timestamp,
    "ProductOrder"                 smallint                 default 0                     not null,
    "ProductJoinCitation"          smallint                 default 0                     not null,
    "ProductDynamicPackCreation"   smallint                 default 0                     not null,
    "ProductIsGiftable"            smallint                 default 0                     not null,
    "ProductTCEnabled"             smallint                 default 0                     not null,
    _ingested_at                   timestamp with time zone default now()                 not null,
    _ingestion_batch_id            bigint
        references ingestion_batches
);

create table clients
(
    "ClientID"               bigint                                                 not null
        primary key,
    "ClientClinicID"         integer                  default 0                     not null,
    "ClientNumber"           bigint,
    "ClientName"             varchar(255)             default ''::character varying not null,
    "ClientSurname1"         varchar(64)              default ''::character varying not null,
    "ClientSurname2"         varchar(64)              default ''::character varying not null,
    "ClientSex"              text                     default 'F'::text             not null,
    "ClientBirthDate"        date,
    "ClientCity"             varchar(64)              default ''::character varying not null,
    "ClientProvince"         varchar(255)             default ''::character varying not null,
    "ClientProvinceID"       bigint                   default 0                     not null,
    "ClientCountry"          varchar(255)             default ''::character varying not null,
    "ClientCountryID"        smallint                 default 0                     not null,
    "ClientPostCode"         varchar(32)              default ''::character varying not null,
    "ClientRefererID"        bigint                   default 0                     not null,
    "ClientSource"           varchar(16)              default ''::character varying not null,
    "ClientZones"            varchar(255)             default ''::character varying not null,
    "ClientDate"             date,
    "ClientTime"             time,
    "ClientLock_Enable"      smallint                 default 0                     not null,
    "ClientVIP"              smallint                 default 0                     not null,
    "ClientFWA"              smallint                 default 0                     not null,
    "ClientJobClassID"       smallint                 default 0                     not null,
    "ClientUserID"           bigint                   default '-1'::integer         not null,
    "ClientStamp"            timestamp,
    "ClientLifeCycleStageID" bigint                   default 1                     not null,
    _ingested_at             timestamp with time zone default now()                 not null,
    _ingestion_batch_id      bigint
        references ingestion_batches
);

create table diary_gen
(
    "DiaryGID"                bigint                                                 not null
        primary key,
    "DiaryGGroupID"           bigint                   default 0                     not null,
    "DiaryGMultID"            bigint                   default 0                     not null,
    "DiaryGClientID"          bigint                   default 0                     not null,
    "DiaryGClinicID"          integer                  default 0                     not null,
    "DiaryGCabinetNum"        smallint                 default 0                     not null,
    "DiaryGUserID"            bigint                   default 0                     not null,
    "DiaryGSUserID"           bigint                   default 0                     not null,
    "DiaryGUserClassID"       smallint                 default 0                     not null,
    "DiaryGPackID"            bigint,
    "DiaryGDate"              date,
    "DiaryGStart"             time,
    "DiaryGEnd"               time,
    "DiaryGColourID"          smallint                 default 0                     not null,
    "DiaryGLaserGID"          bigint                   default 0                     not null,
    "DiaryGLaserDoctor"       smallint                 default 0                     not null,
    "DiaryGLockID"            bigint                   default 0                     not null,
    "DiaryGLocked"            smallint                 default 0                     not null,
    "DiaryGUsesProtocol"      smallint                 default 0                     not null,
    "DiaryGNotUsesInterval"   smallint                 default 0                     not null,
    "DiaryGFWA"               smallint                 default 0                     not null,
    "DiaryGDelayed"           smallint                 default 0                     not null,
    "DiaryGDelayedID"         bigint                   default 0                     not null,
    "DiaryGNotAttended"       smallint                 default 0                     not null,
    "DiaryGNotAttendedReason" text,
    "DiaryGTrackingUID"       bigint                   default 0                     not null,
    "DiaryGTrackingStamp"     timestamp,
    "DiaryGConfirmed"         smallint                 default 0                     not null,
    "DiaryGComments"          text,
    "DiaryGCreated"           timestamp,
    "DiaryGStamp"             timestamp,
    "DiaryGMigrated"          smallint                 default 0                     not null,
    "DiaryGInvisible"         smallint                 default 0                     not null,
    "DiaryGTags"              varchar(255)             default ''::character varying not null,
    "DiaryGCompositionID"     bigint                   default 0                     not null,
    "DiaryGTemporalLock"      smallint                 default 0                     not null,
    "DiaryGTCEnabled"         smallint                 default 0                     not null,
    _ingested_at              timestamp with time zone default now()                 not null,
    _ingestion_batch_id       bigint
        references ingestion_batches
);

create table diary_det
(
    "DiaryID"           bigint                                 not null
        primary key,
    "DiaryGID"          bigint                   default 0     not null,
    "DiaryBudgetID"     bigint                   default 0     not null,
    "DiaryZoneID"       bigint                   default 0     not null,
    "DiaryPackID"       bigint                   default 0     not null,
    "DiaryVoucherID"    bigint                   default 0     not null,
    "DiarySessionID"    smallint                 default 0     not null,
    _ingested_at        timestamp with time zone default now() not null,
    _ingestion_batch_id bigint
        references ingestion_batches
);

create table laser_gen
(
    "LaserGID"            bigint                                 not null
        primary key,
    "LaserGClientID"      bigint                   default 0     not null,
    "LaserGClinicID"      integer                  default 0     not null,
    "LaserGCabinetNum"    bigint                   default 0     not null,
    "LaserGUserID"        bigint                   default 0     not null,
    "LaserGCloseDate"     timestamp,
    "LaserGDate"          date,
    "LaserGStart"         time,
    "LaserGEnd"           time,
    "LaserGClientDelayed" smallint                 default 0     not null,
    "LaserGComments"      text,
    "LaserGTicketGID"     bigint                   default 0     not null,
    "LaserGBudgetGID"     bigint                   default 0     not null,
    "LaserGStamp"         timestamp,
    _ingested_at          timestamp with time zone default now() not null,
    _ingestion_batch_id   bigint
        references ingestion_batches
);

-- Índices reales relevantes (migrations/postgres/002-raw-flow-indexes.sql)
CREATE INDEX IF NOT EXISTS idx_raw_diary_client ON raw_flow.diary_gen ("DiaryGClientID");
CREATE INDEX IF NOT EXISTS idx_raw_diary_delayed_id ON raw_flow.diary_gen ("DiaryGDelayedID");
CREATE INDEX IF NOT EXISTS idx_raw_diary_det_gid ON raw_flow.diary_det ("DiaryGID");
CREATE INDEX IF NOT EXISTS idx_raw_product_stamp ON raw_flow.x_config_products_det ("ProductStamp");

SET search_path TO analytics;
create type appointment_outcome_enum as enum ('ATTENDED_COMPLETED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED_HISTORY', 'IN_PROGRESS', 'FUTURE', 'BLOCKED', 'DRAFT', 'IGNORED', 'UNKNOWN');

create type appointment_detail_enum as enum ('ATTENDED', 'NO_SHOW_CANDIDATE', 'NO_SHOW_REVIEW_SYSTEM', 'CANCELLED_OR_UNCLASSIFIED', 'FUTURE_CANCELLED', 'FUTURE_PENDING', 'SESSION_IN_PROGRESS', 'PAST_UNRESOLVED', 'REVIEW_CONFLICT', 'EXCLUDED');

create type appointment_tracking_origin_enum as enum ('UID_MINUS_ONE', 'USER_POSITIVE', 'ZERO_OR_NULL');

create type appointment_exclusion_reason_enum as enum ('BLOCKED_SLOT', 'RESCHEDULE_HISTORY', 'DRAFT_TAG_16', 'CLINIC_8_LEGACY_RULE', 'OTHER_EXCLUSION');

create type appointment_event_type_enum as enum ('CREATED', 'CONFIRMED', 'ARRIVED_AT_CLINIC', 'RESCHEDULED', 'CANCELLED', 'NO_SHOW', 'SESSION_OPENED', 'SESSION_CLOSED', 'TICKET_CLOSED');

create type appointment_service_phase_enum as enum ('SCHEDULED', 'PERFORMED', 'BILLED');

create table appointment_outcomes
(
    appointment_id           bigint                                             not null
        primary key,
    client_id                bigint                                             not null,
    clinic_id                integer                                            not null,
    appointment_at           timestamp with time zone                           not null,
    created_at_source        timestamp with time zone,
    tracking_at_source       timestamp with time zone,
    tracking_user_id         bigint,
    diary_not_attended_raw   smallint                 default 0                 not null,
    diary_delayed_raw        smallint                 default 0                 not null,
    diary_locked_raw         smallint                 default 0                 not null,
    diary_laser_id           bigint,
    ticket_id                bigint,
    ticket_closed_raw        smallint,
    outcome                  analytics.appointment_outcome_enum                 not null,
    outcome_resolved_at      timestamp with time zone,
    outcome_rule_version     text                                               not null,
    training_eligible        boolean                  default false             not null,
    exclusion_reason         analytics.appointment_exclusion_reason_enum,
    source_batch_id          bigint,
    computed_at              timestamp with time zone default CURRENT_TIMESTAMP not null,
    classification_detail    analytics.appointment_detail_enum,
    is_no_show_candidate     boolean                  default false             not null,
    tracking_origin          analytics.appointment_tracking_origin_enum,
    requires_review          boolean                  default false             not null,
    classification_cutoff_at timestamp with time zone
);

create index idx_outcomes_client_at
    on appointment_outcomes (client_id, appointment_at);

create index idx_outcomes_outcome
    on appointment_outcomes (outcome, appointment_at);

create table appointment_events
(
    event_id        bigint generated always as identity
        primary key,
    appointment_id  bigint                                             not null,
    client_id       bigint                                             not null,
    clinic_id       integer,
    event_type      analytics.appointment_event_type_enum              not null,
    event_at        timestamp with time zone,
    source_table    text                                               not null,
    source_row_id   bigint,
    rule_version    text,
    metadata        jsonb                    default '{}'::jsonb       not null,
    source_batch_id bigint,
    computed_at     timestamp with time zone default CURRENT_TIMESTAMP not null
);

create unique index uq_appointment_events_source_type
    on appointment_events (source_table, source_row_id, event_type);

create index idx_appointment_events_client
    on appointment_events (client_id, event_at)
    where (event_at IS NOT NULL);

create index idx_appointment_events_app
    on appointment_events (appointment_id, event_at)
    where (event_at IS NOT NULL);

create table appointment_services
(
    appointment_id         bigint                                             not null,
    service_phase          analytics.appointment_service_phase_enum           not null,
    source_detail_id       bigint                                             not null,
    product_id             bigint,
    product_parent_id      bigint,
    voucher_id             bigint,
    units                  numeric(14, 3),
    product_type           smallint,
    product_zone_code      varchar(16),
    requires_doctor        boolean,
    metadata               jsonb                    default '{}'::jsonb       not null,
    computed_at            timestamp with time zone default CURRENT_TIMESTAMP not null,
    pack_id                bigint,
    planned_session_number smallint,
    product_family_id      bigint,
    is_medical_evaluation  boolean,
    primary key (appointment_id, service_phase, source_detail_id)
);

create table product_catalog_resolution
(
    product_id              bigint                                             not null
        primary key,
    product_type            smallint,
    product_parent_id       bigint,
    voucher_zone_product_id bigint,
    body_area_product_id    bigint,
    product_family_id       bigint,
    product_zone_code       varchar(32),
    resolution_method       varchar(24)                                        not null
        constraint product_catalog_resolution_resolution_method_check
            check ((resolution_method)::text = ANY
                   ((ARRAY ['SERVICE_PARENT'::character varying, 'VOUCHER_ZONE_PARENT'::character varying, 'MISSING_ZONE'::character varying, 'MISSING_PARENT'::character varying, 'NOT_APPLICABLE'::character varying])::text[])),
    updated_at              timestamp with time zone default CURRENT_TIMESTAMP not null
);

create table ml_history_cumulative_v1
(
    appointment_id                 bigint                                             not null
        primary key,
    client_id                      bigint                                             not null,
    known_at                       timestamp with time zone                           not null,
    event_kind                     smallint                                           not null
        constraint ml_history_cumulative_v1_event_kind_check
            check (event_kind = ANY (ARRAY [0, 1])),
    prior_including_event_attended integer                                            not null,
    prior_including_event_no_show  integer                                            not null,
    last_attended_at               timestamp with time zone,
    last_no_show_at                timestamp with time zone,
    updated_at                     timestamp with time zone default CURRENT_TIMESTAMP not null
);

create index idx_ml_history_client_known_at
    on ml_history_cumulative_v1 (client_id asc, known_at desc, appointment_id desc);

RESET search_path;
