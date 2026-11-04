# Sprint 02 · Migración a PostgreSQL como único almacén (SQLite → `ml.app_*`)

Decisión: [ADR-008](../adr/ADR-008-postgresql-unico-almacen-predictivo.md). Este documento incluye
también el detalle de migraciones de base de datos de Sprint 02 (antes previsto como
`database-migrations.md`).

## 1. Dos conexiones, un motor

```text
                 Backend Fastify + TypeScript
              |                               |
   Conexión FUENTE (solo lectura)      Conexión APP (rol runtime restringido)
   postgresSequelize · DB_*            PredictiveAppDatabase (pg.Pool) · APP_DB_*
   default_transaction_read_only=on    statement_timeout/lock_timeout por sesión
   ReadOnlySqlGuard                    PredictiveAppSqlGuard (SELECT/WITH/INSERT en ml.app_*)
              |                               |
   raw_flow / analytics (FLOWww)       ml.app_* (tablas NUEVAS de la app)
   solo SELECT                         SELECT + INSERT; triggers de inmutabilidad
```

- La fuente no cambió (`src/infrastructure/database/sequelize/postgres/*`).
- La conexión de la app: `src/infrastructure/database/postgres/PredictiveAppDatabase.ts`.
- Las CLI `store:*` usan el rol migrador (migraciones) o el runtime (estado/importación); el rol
  migrador nunca forma parte de la configuración del proceso runtime.

## 2. Esquema y tablas creadas (todas nuevas, prefijo `ml.app_`)

`ml` ya existía (creado por `docker/postgres/init`) y estaba **vacío** en la base real
(inspección de `pg_catalog` del 30/10/2026). No se modificó ningún objeto existente.

| Migración | Objeto                                     | Propósito                                                                     |
| --------- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| runner    | `ml.app_predictive_store_migrations`       | Historial de migraciones (versión, checksum SHA-256, rol, instante).          |
| 001       | `ml.app_prevent_mutation()`                | Función de trigger: `UPDATE`/`DELETE`/`TRUNCATE` ⇒ error `check_violation`.   |
| 001       | `ml.app_predictive_store_identity`         | Fila única que liga la base a un `DATA_SOURCE_MODE`.                          |
| 001       | `ml.app_booking_feature_snapshots`         | Snapshot booking_creation (19 predictoras `jsonb`, hash, evidencia).          |
| 001       | `ml.app_prediction_runs`                   | Run de inferencia explícita (`run_uid` uuid = `predictionRunId` público).     |
| 001       | `ml.app_prediction_model_results`          | Score por modelo + banda research v2 completa (umbrales, hash, advertencias). |
| 002       | `ml.app_overbooking_authorizations`        | HU-06: marca «Habilitado para sobreasignación».                               |
| 002       | `ml.app_attendance_outcomes`               | HU-07: asistencia observada (ATTENDED/NO_SHOW).                               |
| 002       | `ml.app_attendance_prediction_comparisons` | HU-07: comparación por modelo (regla y umbral guardados).                     |
| 002       | `ml.app_space_recovery_outcomes`           | HU-08: espacio recuperado (true/false).                                       |

DDL exacto: [`001_app_predictive_store.sql`](../../migrations/postgres/predictive_app/001_app_predictive_store.sql)
y [`002_app_operational_optimization.sql`](../../migrations/postgres/predictive_app/002_app_operational_optimization.sql).

Garantías en base de datos:

- **Contrato v2 íntegro** (equivalente al SQLite de Sprint 01): `operational_use_allowed = false`;
  `risk_level` solo con política aprobada; banda experimental todo-o-nada; `research_policy_key =
COALESCE(experimental_policy_hash, '')`; algoritmo coherente con el modelo; UNIQUE de idempotencia
  `(snapshot_id, model_key, model_version, research_policy_key)`.
- **FK compuestas entre tablas propias** que impiden vincular datos de otra reserva:
  autorización → `(result_id, run_id, reservation_id, model_key)`; comparación → resultado y
  observación del mismo run y reserva; recuperación → `(authorization_id, reservation_id)`.
  No hay FK, triggers ni índices sobre `raw_flow`/`analytics` (referencia lógica por IDs).
- **Inmutabilidad**: triggers `BEFORE UPDATE OR DELETE` (fila) y `BEFORE TRUNCATE` (sentencia)
  en todas las tablas `ml.app_*`; probado incluso con superusuario de prueba.
- **Idempotencia/concurrencia**: UNIQUE por reserva en HU-06/07/08 + `INSERT … ON CONFLICT DO NOTHING`
  y lectura del ganador (200 si es idéntico, 409 si difiere). Nunca `DO UPDATE`.
- **Columnas de procedencia** `legacy_store`/`legacy_id` en snapshots/runs/resultados para
  reconciliar la importación del histórico SQLite.

## 3. Roles y permisos (mínimo privilegio)

Script manual para el DBA: [`provisioning/roles.sql`](../../migrations/postgres/predictive_app/provisioning/roles.sql).

| Rol                   | Atributos                     | Privilegios                                                                                  |
| --------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| `noshow_app_migrator` | LOGIN, NOSUPERUSER, NOINHERIT | `USAGE, CREATE` en `ml`; dueño de los objetos `ml.app_*` que crea.                           |
| `noshow_app_runtime`  | LOGIN, NOSUPERUSER, NOINHERIT | `USAGE` en `ml`; por default privileges: `SELECT, INSERT` en tablas y `USAGE` de secuencias. |

Ningún rol recibe privilegios sobre `raw_flow` ni `analytics`. El runtime **rechaza arrancar** si su
rol es superusuario o tiene `CREATE` en `ml` (`PRIVILEGED_ROLE_REJECTED`), salvo
`APP_DB_ALLOW_PRIVILEGED_ROLE=true` (solo desarrollo; prohibido en production; el health informa
`restrictedRole=false`).

Verificado en la base de prueba (integración `PostgresPredictiveStore.test.ts` y ensayo manual):
el rol runtime recibe `42501 permission denied` ante `UPDATE`, `DELETE`, `TRUNCATE` y `CREATE`.

## 4. Procedimiento de despliegue (sin SQL destructivo)

Ejecutar en este orden, por el propietario/DBA, sobre la base destino autorizada:

```bash
# 0) Respaldo previo (manual, solo lectura; NO hay restore automático)
pg_dump -h <host> -U <dueño> -d <base> -n ml -Fc -f backup_ml_$(date +%Y%m%d).dump
# 1) Roles (una vez)
psql -v ON_ERROR_STOP=1 -v migrator_password="'…'" -v runtime_password="'…'" \
     -h <host> -U <dueño> -d <base> -f migrations/postgres/predictive_app/provisioning/roles.sql
# 2) Plan (sesión de solo lectura)
APP_DB_MIGRATOR_USER_POSTGRES=noshow_app_migrator APP_DB_MIGRATOR_PASS_POSTGRES=… npm run store:migrate -- --dry-run
# 3) Aplicar + ligar el modo (DATA_SOURCE_MODE del entorno)
PREDICTIVE_STORE_MIGRATION_AUTHORIZED=true APP_DB_MIGRATOR_USER_POSTGRES=… APP_DB_MIGRATOR_PASS_POSTGRES=… npm run store:migrate
# 4) Importar el histórico SQLite (inventario, luego importación con reconciliación)
npm run store:import-legacy -- --sqlite .local/predictive-store/backups/<respaldo>/read_only_existing_schedule.sqlite --dry-run
PREDICTIVE_STORE_IMPORT_AUTHORIZED=true npm run store:import-legacy -- --sqlite .local/predictive-store/backups/<respaldo>/read_only_existing_schedule.sqlite
# 5) Verificar
npm run store:status
curl -s http://127.0.0.1:3000/api/v1/health/predictive-store
```

El histórico sintético (`synthetic_demo_only.sqlite`) solo puede importarse en OTRA base ligada a
`SYNTHETIC_DEMO_ONLY` (el importador rechaza un modo distinto sin escribir).

Rollback: no existe migración `down`. Al ser todo aditivo, el estado anterior equivale a no usar
`ml.app_*` (la fuente no cambió). Cualquier eliminación de objetos requiere una decisión explícita y
separada del propietario.

## 5. Histórico SQLite de Sprint 01: inventario, respaldo y ensayo de reconciliación

- **Respaldo (sin borrar originales):** `.local/predictive-store/backups/pre-postgres-migration-20261031T031009Z/`
  con `SHA256SUMS.original` verificado (`shasum -c`: OK para los 6 archivos `*.sqlite`, `-wal`, `-shm`).
  Los originales siguen en `.local/predictive-store/` (ignorado por Git).
- **Inventario (lectura de una copia):**

  | Archivo                              | Modo                        | Snapshots | Runs | Resultados    | Integridad |
  | ------------------------------------ | --------------------------- | --------- | ---- | ------------- | ---------- |
  | `read_only_existing_schedule.sqlite` | READ_ONLY_EXISTING_SCHEDULE | 32        | 34   | 64 (todos v2) | `ok`       |
  | `synthetic_demo_only.sqlite`         | SYNTHETIC_DEMO_ONLY         | 5         | 5    | 10 (todos v2) | `ok`       |

- **Ensayo completo sobre PostgreSQL de PRUEBA** (contenedor `:55432`, bases desechables ligadas a
  cada modo, roles reales de `roles.sql`, 30/10/2026):

  | Archivo   | Insertados (s/r/res) | Reconciliados (s/r/res) | Discrepancias | Re-ejecución | Origen sin cambios |
  | --------- | -------------------- | ----------------------- | ------------- | ------------ | ------------------ |
  | real      | 32 / 34 / 64         | 32 / 34 / 64            | 0             | 0 insertados | sí (SHA-256 igual) |
  | sintético | 5 / 5 / 10           | 5 / 5 / 10              | 0             | —            | sí                 |

  La reconciliación verifica, por fila: hash de cada snapshot recalculado desde las predictoras
  importadas (`verifySnapshotIntegrity`), presencia de cada `run_uid`, y para cada score:
  probabilidad exacta (float64), `scored_at`, `run_uid`, `model_hash`, nivel, hash y umbrales de la
  banda experimental, `riskLevel` y `operationalUseAllowed=false`. `store:status` tras el ensayo:
  `driver=postgresql`, `schemaVersion=002`, `restrictedRole=true`, 32/34/64, `importedLegacyResults=64`.

## 6. Estado de la base REAL (`depi-noshow-db`) — aplicado el 30/10/2026

Autorizado por el propietario con la condición de **usar solo el superusuario `admin`** (sin crear
roles por ahora) y sin perder ningún dato. Secuencia ejecutada:

1. Inspección de catálogo en solo lectura: `ml` vacío, sin colisiones.
2. **Respaldo completo** `pg_dump -Fc` (solo lectura) en
   `.local/db-backups/depi-noshow-db-full-pre-sprint02-20261031T041856Z.dump` (192 MB, 21 tablas con
   datos verificadas con `pg_restore --list`, SHA-256 en `.dump.sha256`), más copia de `.env` previa.
3. `.env`: bloque `APP_DB_*` con `admin` y `APP_DB_ALLOW_PRIVILEGED_ROLE=true` (decisión temporal).
4. `npm run store:migrate -- --dry-run` ⇒ pendientes 001 y 002; luego `store:migrate` ⇒
   `applied: 001, 002`, identidad `READ_ONLY_EXISTING_SCHEDULE`. Solo se crearon objetos `ml.app_*`.
5. `npm run store:import-legacy` desde el **respaldo** del SQLite real: insertados y reconciliados
   32 snapshots / 34 runs / 64 scores, 0 discrepancias; archivos de origen sin cambios.
6. Verificación: `store:status` ok (esquema 002, 32/34/64, `restrictedRole=false` por usar `admin`);
   arranque real con `/api/v1/health/predictive-store` = `ok`; lectura GET de detalle, `/risk`,
   elegibilidad HU-06 y lista HU-06 sobre la base real (sin escrituras).

`raw_flow`/`analytics` permanecen idénticos (conteos antes = después de todo el proceso):

| Tabla                                     | Filas     | Tabla                      | Filas     |
| ----------------------------------------- | --------- | -------------------------- | --------- |
| analytics.appointment_events              | 259 045   | raw_flow.clients           | 96 469    |
| analytics.appointment_outcomes            | 1 222 752 | raw_flow.diary_det         | 3 037 406 |
| analytics.appointment_services            | 2 161 086 | raw_flow.diary_gen         | 1 222 752 |
| analytics.appointment_training_dataset_v1 | 213 873   | raw_flow.ingestion_batches | 12        |
| analytics.client_history_current          | 96 469    | raw_flow.laser_det         | 841 266   |
| analytics.ml_history_cumulative_v1        | 359 663   | raw_flow.laser_gen         | 302 539   |
| analytics.product_catalog_resolution      | 21 916    | raw_flow.tickets_det       | 1 594 618 |
| analytics.voucher_features_current        | 278 205   | raw_flow.tickets_gen       | 574 951   |
| raw_flow.\_\_x_config_users_view          | 610       | raw_flow.vouchers          | 1 115 705 |
| raw_flow.\_\_x_config_workplaces_view     | 777       | raw_flow.x_config_clinics  | 17        |
| raw_flow.x_config_products_det            | 21 916    | `ml` (antes)               | 0 objetos |

Pendiente recomendado (no ejecutado por decisión del propietario): aprovisionar los roles de
`roles.sql` y cambiar `APP_DB_USER_POSTGRES` a `noshow_app_runtime` con
`APP_DB_ALLOW_PRIVILEGED_ROLE=false`. Como los objetos `ml.app_*` pertenecen a `admin`, en ese
momento el DBA deberá además conceder `SELECT, INSERT` sobre las tablas existentes y `USAGE` de sus
secuencias al rol runtime (los _default privileges_ solo cubren objetos futuros). Mientras se use
`admin`, la protección contra escrituras indebidas recae en el guard de la conexión de la app y en
los triggers de inmutabilidad (que también bloquean al superusuario), no en privilegios.

El histórico sintético (`synthetic_demo_only.sqlite`, 5/5/10) **no** se importó en la base real: es
de otro modo y solo puede ir a otra base ligada a `SYNTHETIC_DEMO_ONLY`; queda preservado en su
archivo y en el respaldo.

## 7. Qué se retiró y qué se conserva

- Retirado del runtime y del control de versiones (queda en el historial git):
  `src/infrastructure/database/sqlite/SqliteDatabase.ts`,
  `src/modules/ReservationRisk/Shared/persistence/sqlite/*`, la prueba unitaria SQLite,
  `PREDICTIVE_STORE_SQLITE_PATH` y `store:backup`.
- `store:status` ahora reporta el almacén PostgreSQL. Nuevos: `store:migrate`, `store:import-legacy`.
- Conservado: archivos `.sqlite` originales y respaldos (material histórico), el runner heredado
  `migrate:app` (marcado obsoleto; su 001 solo soporta v1) y el adaptador `Sequelize*` `ml.*`
  aislado (no conectado).
- Prueba de arquitectura: ningún archivo de `src/` importa `node:sqlite` salvo
  `src/app/cli/ImportLegacySqliteStore.ts` (utilidad puntual, excluida de cobertura y de runtime).

## 8. Health y comandos

`GET /api/v1/health/predictive-store` (sin credencial):

```json
{
  "service": "predictive-store",
  "status": "ok",
  "message": "Almacén predictivo PostgreSQL disponible (raw_flow/analytics permanecen de solo lectura)",
  "driver": "postgresql",
  "schemaVersion": "002",
  "dataSourceMode": "READ_ONLY_EXISTING_SCHEDULE",
  "durable": true,
  "restrictedRole": true,
  "sourceDatabaseWritable": false
}
```

Sin credenciales, host ni nombres de base. `status=error` (503) si la versión de esquema o el modo
no coinciden.
