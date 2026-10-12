# no-show-predictive-app-web — Backend

Backend Fastify 5 + TypeScript del **sistema web predictivo de inasistencias** (TESIS 2026–2027).
Sprint 01 «Core Predictivo» (HU-01, HU-02, HU-03, HU-05, HU-06) + cierre técnico con la política
**research v2** de `depi-noshow-ml` (bandas experimentales LOW/MEDIUM/HIGH). Integra Python sin
modificarlo.

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

- **PostgreSQL = fuente de SOLO LECTURA** (ADR-006): sesión `default_transaction_read_only=on`,
  transacciones `REPEATABLE READ READ ONLY` y guard que bloquea cualquier sentencia de escritura antes
  de enviarla. La app nunca escribe en PostgreSQL; `migrate:app`/`migrate:flow` están bloqueados.
- **Almacén predictivo local SQLite** (`node:sqlite`, sin dependencias nativas): snapshots, runs,
  scores y banda experimental en `.local/predictive-store/<modo>.sqlite` (ignorado por Git, permisos
  0700/0600, migraciones locales versionadas, inmutable, idempotente).
- **Modos de datos** (`DATA_SOURCE_MODE`):
  - `READ_ONLY_EXISTING_SCHEDULE` (defecto): reservas/evidencia/historial reales en solo lectura.
  - `SYNTHETIC_DEMO_ONLY`: dataset sintético versionado (`src/shared/data/synthetic/`), sin ninguna
    lectura de negocio a PostgreSQL y con su propio archivo SQLite. Prohibido en production.

## Requisitos

Node ≥ 24.20, npm. PostgreSQL local (réplica, solo lectura). Python `depi-noshow-ml` para predecir.

## Puesta en marcha (runbook)

```bash
npm ci
cp .env.example .env          # completar credenciales locales (no versionar)
# Credencial interna provisional (no es login): guardar KEY en el servidor consumidor, solo el hash aquí
node -e "const k=require('crypto').randomBytes(32).toString('base64url');console.log('KEY='+k);console.log('SHA256='+require('crypto').createHash('sha256').update(k).digest('hex'))"
#   → INTERNAL_API_KEY_SHA256=<SHA256> en .env
npm run dev                   # PostgreSQL solo lectura + SQLite local en .local/
```

Python (otra terminal, desde `depi-noshow-ml`, ver `docs/python_to_backend_handoff.md`): arrancar Uvicorn
en `127.0.0.1:8001` con `ML_ENABLE_RESEARCH_RISK=true` y la misma clave que `ML_SERVICE_KEY` de Node
(`ML_API_SERVICE_KEY`). Python no lee `.env` solo: usar `--env-file` o exportar variables.

Demo sintética (sin PostgreSQL de negocio), en otra terminal:

```bash
DATA_SOURCE_MODE=SYNTHETIC_DEMO_ONLY PORT=3001 npm run dev
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
npm run store:status          # estado/conteos del SQLite del modo activo (sin datos)
npm run store:backup          # copia consistente VACUUM INTO en .local/predictive-store/backups/
```

## API (`/api/v1`, requiere `x-api-key` salvo health)

| Método | Ruta                               | Uso                                                                     |
| ------ | ---------------------------------- | ----------------------------------------------------------------------- |
| GET    | `/reservations`                    | listado paginado; `sort`, `modelKey`, `experimentalRiskLevel`, `cursor` |
| GET    | `/reservations/:id`                | detalle factual + scores persistidos (con `experimentalRisk`)           |
| GET    | `/reservations/:id/risk`           | lectura de scores y bandas (sin llamar a Python)                        |
| POST   | `/reservations/:id/predictions`    | acción explícita idempotente (`{"mode":"compare"}`), Python v2          |
| GET    | `/reservations/:id/risk/factors`   | SHAP v1 bajo demanda sobre el snapshot guardado                         |
| GET    | `/reservations/:id/client-history` | historial as-of                                                         |
| GET    | `/ml/models`                       | identidad de modelos + resumen de política experimental                 |
| GET    | `/ml/research-risk-policy`         | política experimental v2 (límites, hashes, advertencias; no aprobada)   |
| GET    | `/health/ml`                       | disponibilidad ML (sin credencial)                                      |
| GET    | `/health/predictive-store`         | estado del almacén local (sin credencial, sin rutas ni datos)           |

Contrato completo, errores y handoff frontend: [`docs/sprint-01/api_contract.md`](docs/sprint-01/api_contract.md).

## Configuración relevante

`ML_RESEARCH_RISK_ENABLED` (defecto `true`: el POST exige política v2 disponible; sin ella ⇒ `503
RESEARCH_RISK_POLICY_NOT_READY`, nunca un score sin banda ni `LOW`), `ML_RESEARCH_EXPECTED_POLICY_HASHES`
(allowlist opcional), `PREDICTIVE_STORE_SQLITE_PATH` (opcional). Ver `.env.example`.

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
npm run test:db:up            # (opcional) PostgreSQL de PRUEBA aislado (:55432, tmpfs) para integración SQL
```

Ver [`docs/sprint-01/testing.md`](docs/sprint-01/testing.md). Nunca ejecutar `docker compose down -v`
sobre `docker-compose.yml` (volumen con datos reales).

## Documentación

`docs/sprint-01/` (scope, architecture, source_inventory, feature_lineage, api_contract, ml_integration,
database, testing, performance, acceptance_matrix, implementation_report), decisiones
`docs/adr/ADR-001…007` y cierre técnico [`docs/backend-node-final-closeout-20261011.md`](docs/backend-node-final-closeout-20261011.md).
