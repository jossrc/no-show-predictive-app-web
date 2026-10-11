# Sprint 01 — Inventario de fuentes (verificado)

Verificación del 10-10-2026 sobre el contenedor local `depi_noshow` (PostgreSQL 18.4, TZ `Etc/UTC`)
**solo en modo lectura** (`default_transaction_read_only=on`): `information_schema`, `pg_indexes`,
conteos agregados y `EXPLAIN` sin `ANALYZE`. No se extrajeron ni registraron filas de clientes.
Los volcados de estructura `bd/raw_flow.sql` y `bd/analytics.sql` coinciden con lo consultado.

## Esquemas

| Schema      | Naturaleza                                                                    | Uso en Sprint 01                                                         |
| ----------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `raw_flow`  | Réplica FLOWww (12 lotes `DIRECT_MYSQL`, `dataset_date` 2026-10-07)           | Solo lectura                                                             |
| `analytics` | Tablas ETL interpretadas (outcomes calculados 2026-10-08 01:58 UTC)           | Solo lectura                                                             |
| `ml`        | Creado vacío por `docker/postgres/init` ("Modelos, snapshots y predicciones") | **Propiedad de la app**: migración `001` (no aplicada aún en la BD real) |

## Columnas leídas (tipos confirmados en `information_schema.columns`)

| Tabla                                  | Columnas                                                                                                                                                                                                                          | Notas                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `analytics.appointment_outcomes`       | `appointment_id` int8, `client_id` int8, `clinic_id` int4, `appointment_at` timestamptz, `created_at_source` timestamptz, `outcome` enum, `classification_detail` enum, `classification_cutoff_at` timestamptz                    | Universo del listado: `outcome='FUTURE'` (programada) y `classification_detail='FUTURE_CANCELLED'` (cancelada futura) |
| `raw_flow.diary_gen`                   | `DiaryGID`, `DiaryGClientID`, `DiaryGClinicID`, `DiaryGDate` date, `DiaryGStart`/`DiaryGEnd` time, `DiaryGFWA` int2, `DiaryGDelayed` int2, `DiaryGDelayedID` int8, `DiaryGCreated`/`DiaryGStamp` timestamp, `_ingestion_batch_id` | Hora de pared de Lima (sin zona) ⇒ `AT TIME ZONE 'America/Lima'`                                                      |
| `raw_flow.clients`                     | `ClientID`, `ClientBirthDate` date, `ClientSex` text, `ClientStamp` timestamp                                                                                                                                                     | Sin nombres/contacto: no se leen                                                                                      |
| `raw_flow.x_config_products_det`       | `ProductID`, `ProductType` int2, `ProductEvaluation` int2, `ProductStamp` timestamp                                                                                                                                               | `ProductStamp` = última modificación                                                                                  |
| `raw_flow.x_config_clinics`            | `ClinicID`                                                                                                                                                                                                                        | Validación de `clinicId`                                                                                              |
| `analytics.appointment_services`       | `appointment_id`, `service_phase` enum, `source_detail_id`, `product_id`, `product_type`, `is_medical_evaluation`                                                                                                                 | Solo `SCHEDULED` (misma fuente que el ETL 14)                                                                         |
| `analytics.product_catalog_resolution` | `product_id`, `body_area_product_id`, `voucher_zone_product_id`, `resolution_method`                                                                                                                                              | Catálogo **actual** (sin versionado)                                                                                  |
| `analytics.ml_history_cumulative_v1`   | `appointment_id`, `client_id`, `known_at` timestamptz, `event_kind` (0/1), `prior_including_event_*`, `last_attended_at`, `last_no_show_at`                                                                                       | Historial as-of; sin cancelaciones                                                                                    |
| `analytics.appointment_events`         | `appointment_id`, `event_type` enum, `event_at`                                                                                                                                                                                   | Solo `RESCHEDULED` (259.045, 0 con `event_at` nulo)                                                                   |

Tablas **no usadas** deliberadamente: `appointment_training_dataset_v1` (solo pruebas offline de
paridad en BD de prueba), `client_history_current`, `voucher_features_current`, `laser_det`,
`tickets_*`, `vouchers`.

## Índices existentes utilizados

`idx_outcomes_outcome (outcome, appointment_at)`, `appointment_outcomes_pkey`,
`idx_appointment_events_app (appointment_id, event_at) WHERE event_at IS NOT NULL`,
`idx_raw_diary_delayed_id`, `appointment_services_pkey`, `idx_ml_history_client_known_at
(client_id, known_at DESC, appointment_id DESC)`. **No se crearon índices** en `raw_flow`/`analytics`.
El primer plan del listado hacía `Seq Scan` de `appointment_events` (subplan hasheado, coste
≈115 k); añadir `event_at IS NOT NULL` (predicado del índice parcial; 0 eventos con nulo) y la
rama equivalente sobre `diary_gen` bajó el coste estimado a ≈580 con `Index Scan`.

## Agregados de elegibilidad (reservas `FUTURE`, 10-10-2026)

| Métrica                                                                                     |                             Valor |
| ------------------------------------------------------------------------------------------- | --------------------------------: |
| Reservas `FUTURE_PENDING` (2026-10-08 … 2027-03-06)                                         |                             8.887 |
| … cuya cita ya pasó respecto de hoy (clasificación desactualizada ⇒ `STALE_CLASSIFICATION`) |                             1.646 |
| … sin `DiaryGCreated`                                                                       |                                 0 |
| … con creación ≥ cita / anticipación > 730 días                                             |                             0 / 0 |
| … reprogramadas (evento o copia desplazada)                                                 |                             1.062 |
| … con cliente modificado en/después de la reserva (o sin marca)                             |                             1.048 |
| … con catálogo modificado en/después de la reserva o sin resolución                         |                             4.803 |
| … sin líneas de servicio programadas                                                        |                                 0 |
| … que pasan todo salvo la captura fechada de servicios                                      |                             3.141 |
| … con evidencia temporal de servicios al reservar                                           | **0** (la réplica no la registra) |
| Canceladas futuras (`FUTURE_CANCELLED`)                                                     |                           110.861 |
| `DiaryGStamp = DiaryGCreated` (nunca modificada tras crearse)                               |                        0 de 8.887 |

**Conclusión verificable:** con la réplica actual **ninguna** reserva real puede demostrar la foto de
reserva de sus servicios programados (`diary_det`/`appointment_services` no guardan cuándo se creó
cada línea). Por eso, en modo `READ_ONLY_EXISTING_SCHEDULE` todas las reservas reales responden
`NOT_SCORABLE` con motivos tipados (comprobado contra la BD real: 5.554 reservas del 12 al 31-oct,
100 % `NOT_SCORABLE`). No se inventan probabilidades.

## Modo de datos que opera realmente

| Modo                                                                      | ¿Opera?                                                                                   | Evidencia                                                                                                                                           |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `READ_ONLY_EXISTING_SCHEDULE`                                             | **Sí (por defecto)**: listado, detalle, historial reales; scoring bloqueado por evidencia | Smoke real: 401 sin credencial, listado 200 (p50 9,4 ms por página de 100), `GET /risk` 200 `NOT_SCORABLE`, `POST` 409, factores 409, historial 200 |
| `VERIFIED_BOOKING_SNAPSHOT` (evidencia en `ml.booking_feature_snapshots`) | **No**: no existe hoy una captura fechada al reservar; el código la admite si se crea     | 0 snapshots en la BD real (schema `ml` sin migrar)                                                                                                  |
| `SYNTHETIC_DEMO_ONLY`                                                     | Sí, **solo** en `depi_noshow_test` (docker-compose.test.yml)                              | E2E con BD de prueba + Python simulado y real                                                                                                       |

## Frescura

`raw_flow` refleja la ingesta del 2026-10-07 (último `DiaryGCreated` 16:47 Lima);
`appointment_outcomes` se clasificó el 2026-10-08. La clasificación `FUTURE` es relativa a ese
corte: las respuestas exponen `classificationCutoffAt` y `sourceFreshness`.
