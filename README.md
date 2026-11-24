# no-show-predictive-app-web — Backend

Backend Fastify 5 + TypeScript del **sistema web predictivo de inasistencias** (TESIS 2026–2027).
Sprint 01 «Core Predictivo» (HU-01, HU-02, HU-03, HU-05, HU-06) + cierre técnico con la política
**research v2** de `depi-noshow-ml` (bandas experimentales LOW/MEDIUM/HIGH) y **Sprint 02
«Optimización Operativa»** (HU-06 habilitación para sobreasignación, HU-07 resultado real, HU-08
espacios recuperados; backend). Integra Python sin modificarlo. **Persistencia 100 % PostgreSQL**
(ADR-008): ya no se usa SQLite.

> ⚠️ **Dos clasificaciones distintas — no confundirlas:**
>
> - `riskLevel` (riesgo **operativo**) es **siempre `null`**: no existe política científica/comercial
>   aprobada (`riskPolicyStatus=pending_validation`). Filtrar/ordenar por él ⇒ `409 RISK_POLICY_UNAVAILABLE`.
> - `experimentalRisk` (banda **experimental**) es la clasificación Bajo/Medio/Alto (exploratorio)
>   publicada por Python v2 (`research_risk_v1_1`) **por modelo** (RF y XGB nunca se combinan):
>   terciles relativos del score crudo, `status=RESEARCH_PROVISIONAL`, `approvedBy=null`. **No** es
>   probabilidad de inasistencia ni riesgo clínico; `operationalUseAllowed=false` siempre.
>
> Las probabilidades son estimaciones exploratorias no calibradas (`EXPLORATORY_NOT_VALIDATED`). Con la
> reglas confirmadas de FLOWww, una reserva sin copias históricas ni eventos contradictorios conserva
> el horario y los servicios originales (`FLOWWW_UNCHANGED_BOOKING`). Se evalúan además cliente,
> creación y catálogo. Las reservas modificadas siguen restringidas mientras no se reconstruya una
> versión original compatible con el entrenamiento; el listado muestra `NOT_SCORED` preliminar
> hasta la verificación completa en `/risk` o `/predictions`.

## Arquitectura y datos

Screaming Architecture + Vertical Slices (`src/modules/<Módulo>/<Feature>/{application,presentation}`),
handlers `handle()`, operaciones `execute()`, `*Module.ts` como composition root. Detalle:
[`docs/sprint-01/architecture.md`](docs/sprint-01/architecture.md).

- **Fuente FLOWww `raw_flow`/`analytics` = SOLO LECTURA** (ADR-006, vigente): conexión `DB_*` con
  `default_transaction_read_only=on`, `REPEATABLE READ READ ONLY` y guard que bloquea escrituras.
- **Almacén predictivo PostgreSQL de la app** (ADR-008): conexión SEPARADA `APP_DB_*` con rol
  runtime restringido (`SELECT/INSERT` en `ml.app_*`, sin UPDATE/DELETE/DDL), guard de sentencias y
  triggers de inmutabilidad. Tablas nuevas `ml.app_*` (snapshots, runs, scores research v2 y registros
  HU-06/07/08) creadas por migraciones **solo `up`** con un rol migrador (`npm run store:migrate`).
  La base queda ligada a un modo de datos; cualquier discrepancia aborta el arranque (sin fallback).
- **Modos de datos** (`DATA_SOURCE_MODE`):
  - `READ_ONLY_EXISTING_SCHEDULE` (defecto): reservas/evidencia/historial reales en solo lectura.
  - `SYNTHETIC_DEMO_ONLY`: dataset sintético versionado (`src/shared/data/synthetic/`), sin ninguna
    lectura de negocio a la fuente y con su propio almacén PostgreSQL (otra base, ligada a ese modo).
    Prohibido en production.

## Requisitos

Node ≥ 24.20, npm. PostgreSQL local (réplica de solo lectura + almacén `ml.app_*` con roles
aprovisionados, ver [`docs/sprint-02/postgresql-only-migration.md`](docs/sprint-02/postgresql-only-migration.md)).
Python `depi-noshow-ml` para predecir.

## Puesta en marcha (runbook)

```bash
npm ci
cp .env.example .env          # completar credenciales locales (no versionar)
# Credencial interna provisional (no es login): guardar KEY en el servidor consumidor, solo el hash aquí
node -e "const k=require('crypto').randomBytes(32).toString('base64url');console.log('KEY='+k);console.log('SHA256='+require('crypto').createHash('sha256').update(k).digest('hex'))"
#   → INTERNAL_API_KEY_SHA256=<SHA256> en .env
# Almacén de la app (una vez, por el DBA): roles + migraciones aditivas + identidad de modo
#   psql … -f migrations/postgres/predictive_app/provisioning/roles.sql
#   npm run store:migrate -- --dry-run
#   PREDICTIVE_STORE_MIGRATION_AUTHORIZED=true APP_DB_MIGRATOR_USER_POSTGRES=… APP_DB_MIGRATOR_PASS_POSTGRES=… npm run store:migrate
npm run dev                   # fuente solo lectura (DB_*) + almacén PostgreSQL de la app (APP_DB_*)
```

Python (otra terminal, desde `depi-noshow-ml`, ver `docs/python_to_backend_handoff.md`): arrancar Uvicorn
en `127.0.0.1:8001` con `ML_ENABLE_RESEARCH_RISK=true` y la misma clave que `ML_SERVICE_KEY` de Node
(`ML_API_SERVICE_KEY`). Python no lee `.env` solo: usar `--env-file` o exportar variables.

Demo sintética (sin la fuente FLOWww), en otra terminal, con OTRA base de almacén ligada al modo
sintético (p. ej. creada y migrada en el clúster de prueba `:55432`):

```bash
DATA_SOURCE_MODE=SYNTHETIC_DEMO_ONLY APP_DB_NAME_POSTGRES=<base_sintetica> PORT=3001 npm run dev
```

Comprobación sin revelar secretos (`INTERNAL_API_KEY` solo en la variable de la terminal):

```bash
curl -s http://127.0.0.1:3000/api/health/postgres
curl -s http://127.0.0.1:3000/api/v1/health/ml
curl -s http://127.0.0.1:3000/api/v1/health/predictive-store
curl -s -H "x-api-key: $INTERNAL_API_KEY" http://127.0.0.1:3000/api/v1/ml/research-risk-policy
curl -s -H "x-api-key: $INTERNAL_API_KEY" "http://127.0.0.1:3000/api/v1/reservations?from=2026-10-12&to=2026-10-31&limit=5"
# Demo sintética: predicción explícita y banda experimental
curl -s -X POST -H "x-api-key: $INTERNAL_API_KEY" -H 'content-type: application/json' \
  -d '{"mode":"compare"}' http://127.0.0.1:3001/api/v1/reservations/900000000101005/predictions
curl -s -H "x-api-key: $INTERNAL_API_KEY" "http://127.0.0.1:3001/api/v1/reservations?from=2026-11-01&to=2026-11-30&modelKey=xgboost_full_v1&experimentalRiskLevel=HIGH"
curl -s -H "x-api-key: $INTERNAL_API_KEY" "http://127.0.0.1:3001/api/v1/reservations/900000000101005/risk/factors?modelKey=xgboost_full_v1"
npm run store:status          # estado/conteos del almacén PostgreSQL de la app (sin datos)
# Respaldo: pg_dump manual del operador (ver docs/sprint-02/postgresql-only-migration.md)
```

## API (`/api/v1`, requiere `x-api-key` salvo health)

| Método | Ruta                                           | Uso                                                                     |
| ------ | ---------------------------------------------- | ----------------------------------------------------------------------- |
| GET    | `/reservations`                                | listado paginado; `sort`, `modelKey`, `experimentalRiskLevel`, `cursor` |
| GET    | `/reservations/:id`                            | detalle factual + scores persistidos (con `experimentalRisk`)           |
| GET    | `/reservations/:id/risk`                       | lectura de scores y bandas (sin llamar a Python)                        |
| POST   | `/reservations/:id/predictions`                | acción explícita idempotente (`{"mode":"compare"}`), Python v2          |
| GET    | `/reservations/:id/risk/factors`               | SHAP v1 bajo demanda sobre el snapshot guardado                         |
| GET    | `/reservations/:id/client-history`             | historial as-of                                                         |
| GET    | `/ml/models`                                   | identidad de modelos + resumen de política experimental                 |
| GET    | `/ml/research-risk-policy`                     | política experimental v2 (límites, hashes, advertencias; no aprobada)   |
| GET    | `/health/ml`                                   | disponibilidad ML (sin credencial)                                      |
| GET    | `/health/predictive-store`                     | estado del almacén PostgreSQL de la app (`driver: postgresql`)          |
| POST   | `/reservations/:id/overbooking-authorizations` | HU-06: habilitar horario HIGH para sobreasignación                      |
| GET    | `/reservations/:id/overbooking-authorization`  | HU-06: estado de la marca + elegibilidad calculada                      |
| GET    | `/overbooking-authorizations`                  | HU-06: listado paginado de horarios habilitados                         |
| POST   | `/reservations/:id/attendance-outcomes`        | HU-07: registrar asistencia real (ATTENDED/NO_SHOW)                     |
| GET    | `/reservations/:id/attendance-outcome`         | HU-07: resultado real + comparación por modelo                          |
| GET    | `/attendance-outcomes`                         | HU-07: listado paginado (insumo HU-12)                                  |
| POST   | `/reservations/:id/space-recovery-outcomes`    | HU-08: registrar espacio recuperado (true/false)                        |
| GET    | `/reservations/:id/space-recovery-outcome`     | HU-08: resultado de recuperación                                        |
| GET    | `/space-recovery-outcomes`                     | HU-08: listado paginado (insumo HU-13)                                  |
| POST   | `/reservation-imports`                         | incorporar reservas desde CSV/XLSX (multipart, campo `file`)            |
| GET    | `/retention/priority-clients`                  | clientes con cita en 72 h y banda experimental HIGH vigente (paginado)  |
| GET    | `/retention/priority-clients/export`           | mismo listado completo en CSV (UTF-8 con BOM, anti-fórmulas)            |
| POST   | `/reservations/:id/retention-contacts`         | registrar una acción de retención realizada (no envía mensajes)         |

`GET /reservations` y `GET /reservations/:id` incluyen además (aditivo) `overbooking`,
`attendanceOutcome` y `spaceRecoveryOutcome`. Contratos: Sprint 01
[`docs/sprint-01/api_contract.md`](docs/sprint-01/api_contract.md); Sprint 02
[`docs/sprint-02/api-contract.md`](docs/sprint-02/api-contract.md) y handoff frontend
[`docs/sprint-02/frontend-handoff.md`](docs/sprint-02/frontend-handoff.md). Importación de reservas y
retención: [`docs/reservation-import-and-retention/README.md`](docs/reservation-import-and-retention/README.md)
y [`frontend-integration.md`](docs/reservation-import-and-retention/frontend-integration.md). Ambos
listados exponen además (aditivo) `origin` (`SOURCE`/`IMPORT`) e `importBatchId`.

## Configuración relevante

`ML_RESEARCH_RISK_ENABLED` (defecto `true`: el POST exige política v2 disponible; sin ella ⇒ `503
RESEARCH_RISK_POLICY_NOT_READY`, nunca un score sin banda ni `LOW`), `ML_RESEARCH_EXPECTED_POLICY_HASHES`
(allowlist opcional), `APP_DB_*_POSTGRES` (almacén de la app, obligatorio con rutas de negocio),
`APP_DB_STATEMENT_TIMEOUT_MS`, `APP_DB_ALLOW_PRIVILEGED_ROLE` (solo desarrollo local),
`RESERVATION_IMPORT_MAX_FILE_BYTES` / `RESERVATION_IMPORT_MAX_ROWS` (límites de importación). Ver `.env.example`.

## Documentación interactiva — Scalar API Reference

Con `NODE_ENV=development`: Scalar en `/docs`, OpenAPI JSON en `/docs/openapi.json` y YAML en
`/docs/openapi.yaml`, generados desde los JSON Schemas de las rutas registradas (no se registran en
`test` ni `production`). En Scalar seleccionar `InternalApiKey` e introducir la clave original en texto
plano (se envía como `x-api-key`). Ni el hash `INTERNAL_API_KEY_SHA256` ni la clave de Python sirven
ahí. Los ejemplos son sintéticos. Verificado el 2026-10-11: `/docs` 200 y 13 rutas en el OpenAPI.

## Pruebas

```bash
npm run check                 # typecheck + format:check + unit/contract/e2e + build
npm run test:coverage         # umbrales 85 % líneas / 80 % ramas
# Integración real con Python (opt-in, la clave se pasa por variable, nunca en el comando literal):
ML_RUN_REAL_INTEGRATION=1 ML_REAL_SERVICE_URL=http://127.0.0.1:8001 ML_REAL_SERVICE_KEY="$ML_KEY" npm run test:integration
npm run test:sprint3          # importación de reservas + retención (unit/HTTP + integración PostgreSQL aislada)
npm run test:db:up            # PostgreSQL de PRUEBA aislado (:55432, tmpfs): requerido por las suites
                              # que persisten (cada suite crea y elimina su propia base desechable)
```

Ver [`docs/sprint-01/testing.md`](docs/sprint-01/testing.md). Nunca ejecutar `docker compose down -v`
sobre `docker-compose.yml` (volumen con datos reales).

## Documentación

`docs/sprint-01/` (scope, architecture, source_inventory, feature_lineage, api_contract, ml_integration,
database, testing, performance, acceptance_matrix, implementation_report), `docs/sprint-02/`
(backend-implementation, api-contract, frontend-handoff, postgresql-only-migration,
acceptance-and-tests, openapi.json), `docs/reservation-import-and-retention/` (README, frontend-integration,
plantillas sintéticas CSV/XLSX, openapi.json), decisiones `docs/adr/ADR-001…008` y cierre técnico [`docs/backend-node-final-closeout-20261011.md`](docs/backend-node-final-closeout-20261011.md).
