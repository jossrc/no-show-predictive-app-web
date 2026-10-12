# Sprint 01 — Base de datos (almacén predictivo)

> **Vigente desde 2026-10-11 (ADR-006):** PostgreSQL es fuente de **solo lectura** y el almacén
> predictivo runtime es **SQLite local** (sección siguiente). El diseño del schema `ml` de abajo se
> conserva como referencia para un futuro adaptador autorizado; **no está aplicado ni conectado**.

## Almacén runtime: SQLite local (`node:sqlite`)

- Archivo por modo: `.local/predictive-store/read_only_existing_schedule.sqlite` y
  `.local/predictive-store/synthetic_demo_only.sqlite` (o `PREDICTIVE_STORE_SQLITE_PATH`). Directorio
  0700, archivo/WAL 0600, ignorado por Git. `store_meta` liga el archivo a su modo: abrirlo con otro modo
  falla (`PERSISTENCE_UNAVAILABLE`/`STORE_MODE_MISMATCH`).
- Pragmas: WAL, `synchronous=FULL`, `foreign_keys`, `busy_timeout`, `trusted_schema=OFF`, modo defensivo.
- Migraciones locales versionadas e idempotentes (`schema_migrations` con SHA-256; un checksum distinto
  aborta): `src/modules/ReservationRisk/Shared/persistence/sqlite/PredictiveStoreSchema.ts` (v`001`).
- Tablas `STRICT`: `booking_feature_snapshots` (UNIQUE reserva+hash, `prediction_at < appointment_at`),
  `prediction_runs` (`scoring_api_version`), `prediction_model_results` (score float64 sin redondeo,
  identidad completa, `model_hash_sha256`, banda experimental completa o ausente, `risk_level` solo con
  política aprobada, `operational_use_allowed=0`, UNIQUE snapshot+modelo+versión+`research_policy_key`).
  Triggers sin UPDATE/DELETE en las tres. Índices por reserva/modelo/fecha y por modelo/política.
- Transacciones `BEGIN IMMEDIATE` síncronas y cortas; la llamada a Python ocurre fuera. Single-flight
  en proceso + UNIQUE: 6 POST concurrentes ⇒ 1 inferencia, 1 run, 2 resultados (probado con Python real).
- Operación: `npm run store:status` (versión, integridad `quick_check`, conteos) y `npm run store:backup`
  (`VACUUM INTO` en `.local/predictive-store/backups/`, 0600). No hay limpieza de la fuente.
- PII mínima: las 19 features (incluye edad y sexo) se guardan para reproducir SHAP; no se exponen por API.

## Diseño de referencia del schema `ml` (PostgreSQL, no aplicado)

Se usa el schema **`ml`**, que ya existía vacío (creado por `docker/postgres/init/01-create-schemas.sql`
con el comentario «Modelos, snapshots y predicciones»). Nada se crea en `raw_flow`/`analytics`.
Acceso a datos: SQL parametrizado vía `sequelize.query` (Sequelize/`sequelize-typescript` se
conservan como cliente); sin `sync()`. Ver ADR-002.

## Migración `migrations/postgres/app/001_ml_predictive_store.{up,down}.sql`

| Tabla                          | Propósito                                                                                                                                                                    | Claves e integridad                                                                                                                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ml.booking_feature_snapshots` | Snapshot inmutable `booking_creation`: 19 features (jsonb), versiones, hash SHA-256, `evidence_source` (`VERIFIED_BOOKING_SNAPSHOT`/`SYNTHETIC_DEMO_ONLY`), evidencia mínima | PK identity; `UNIQUE(reservation_id, snapshot_hash)`; `CHECK prediction_at < appointment_at`; trigger anti-UPDATE                                                                                                      |
| `ml.prediction_runs`           | Ejecución auditable (POST): `run_uid`, modo, modelos pedidos, `request_id` opaco, `run_requested_at`, `completed_at`, latencia ML                                            | FK → snapshot; trigger anti-UPDATE                                                                                                                                                                                     |
| `ml.prediction_model_results`  | Un score por (snapshot, modelo, versión): versión, hash, `feature_version`, `prediction_at` (= creación de reserva), `scored_at`, probabilidad sin redondeo, estados         | `UNIQUE(snapshot_id, model_key, model_version)`; `CHECK 0≤p≤1`; `CHECK operational_use_allowed=false`; `risk_level` sin DEFAULT, solo con `risk_policy_version` y `risk_policy_status='approved'`; trigger anti-UPDATE |

Índices: `(reservation_id, created_at DESC, snapshot_id DESC)`, `(reservation_id, model_key,
scored_at DESC, result_id DESC)`, `(snapshot_id)` en runs, `(run_id)` en resultados.
`reservation_id`/`client_id` son `bigint` (referencias **lógicas** a la réplica: no hay FK entre
schemas para no acoplar la ingesta); en TypeScript viajan como string decimal.

**PII mínima**: sin nombres, documentos ni contacto. Las 19 features incluyen edad y sexo porque son
indispensables para reproducir SHAP con el mismo snapshot; se versionan y no se exponen por API.

## Idempotencia y transacciones (sin locks durante la inferencia)

1. Lecturas fuente en transacción `REPEATABLE READ READ ONLY` con `statement_timeout` local (10 s) y
   `jit=off` local.
2. Snapshot: `INSERT … ON CONFLICT (reservation_id, snapshot_hash) DO NOTHING` y relectura en otra
   sentencia si hubo conflicto.
3. Antes de llamar a Python: se buscan resultados por (snapshot, modelo, versión vigente del
   catálogo); si existen, no hay inferencia (`200`, `replayed=true`).
4. La llamada HTTP ocurre **fuera** de toda transacción.
5. Persistencia: una transacción `READ COMMITTED` inserta el run y los resultados con
   `ON CONFLICT DO NOTHING`; si nada se insertó (petición concurrente ganadora) se revierte para no
   dejar runs huérfanos y se leen los registros ganadores. Probado con 6 peticiones simultáneas ⇒
   1 run y 2 resultados. No se promete «exactly-once» distribuido: un crash entre Python y el commit
   puede provocar una nueva inferencia, deduplicada por la clave única.

## Ejecución (BLOQUEADA: requiere `ML_SCHEMA_WRITE_AUTHORIZED=true` y autorización expresa)

```bash
npm run migrate:app -- --dry-run      # muestra base destino, aplicadas y pendientes; no escribe
npm run migrate:app                   # aplica 001 en una transacción (lock_timeout 15 s), registra checksum
# Revertir SOLO en bases desechables (nombre con test/synthetic/demo) y confirmando el nombre:
npm run migrate:app -- --down --confirm-database=depi_noshow_test
```

El runner (`AppMigrationRunner`) guarda versión + SHA-256 en `ml.app_schema_migrations`, aborta si
el checksum de una migración aplicada cambió y nunca se ejecuta al arrancar el servidor.
`up`, idempotencia, constraints, inmutabilidad y `down` se probaron en `depi_noshow_test`
(`tests/integration/database/postgres/AppMigrations.test.ts`). En runtime ya no se usa: el listado
lee la fuente sin `ml.*` y los scores salen del SQLite local. El adaptador `ml` falla cerrado ante
scores v2 (`EXPERIMENTAL_RISK_NOT_SUPPORTED`) porque la migración 001 no tiene columnas research.

## Permisos mínimos recomendados (documentados, no ejecutados)

```sql
CREATE ROLE noshow_api LOGIN PASSWORD '<definir fuera del repositorio>';
GRANT USAGE ON SCHEMA raw_flow, analytics TO noshow_api;
GRANT SELECT ON raw_flow.diary_gen, raw_flow.clients, raw_flow.x_config_products_det,
  raw_flow.x_config_clinics, analytics.appointment_outcomes, analytics.appointment_events,
  analytics.appointment_services, analytics.product_catalog_resolution,
  analytics.ml_history_cumulative_v1 TO noshow_api;
GRANT USAGE ON SCHEMA ml TO noshow_api;
GRANT SELECT, INSERT ON ml.booking_feature_snapshots, ml.prediction_runs, ml.prediction_model_results TO noshow_api;
-- Las migraciones las ejecuta un rol distinto (propietario de ml); nunca superusuario en runtime.
```
