# Sprint 01 — Pruebas

Todas las pruebas viven en `tests/` (ninguna en `src/`; lo verifica el test de arquitectura).
Runner: `node:test` + `node:assert/strict` con `tsx` (sin dependencias nuevas).
`tests/setup/TestEnvironment.ts` fija **todas** las variables de entorno antes de cargar `src/`
para que el `.env` local (BD real) nunca se use en pruebas.

## Estructura

```text
tests/
  setup/TestEnvironment.ts
  unit/            arquitectura, app/http, config, shared, infrastructure (ML, resiliencia), módulos (application, Shared)
  contracts/ml/    OpenAPI anclado por SHA + validación AJV de peticiones y goldens
  e2e/             fastify.inject + dobles en memoria (Security, Reservations, ReservationRisk, ClientHistory, Health, Sprint01)
  integration/     PostgreSQL de PRUEBA (docker-compose.test.yml) y Python real opcional
  performance/     benchmark opt-in (RUN_PERFORMANCE=1)
  fixtures/        ml/ goldens SINTÉTICOS (respuestas reales de Python a entradas artificiales), database/ DDL solo-estructura + datasets sintéticos
  helpers/         BuildTestApp, TestDatabase (guarda anti-BD-real), FakePredictionClient, InMemory*, FakeRiskPolicy (solo tests), MakeSyntheticReservation
  scripts/         SeedSyntheticDemo (demo manual en la BD de prueba)
```

## Comandos

| Comando                                                                                          | Qué ejecuta                                                                             | Requiere                           |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------- |
| `npm test`                                                                                       | unit + contract + e2e                                                                   | nada                               |
| `npm run test:unit` / `test:contract` / `test:e2e`                                               | cada nivel                                                                              | nada                               |
| `npm run test:db:up`                                                                             | levanta `depi_noshow_test` (127.0.0.1:55432, tmpfs, proyecto Compose propio)            | Docker                             |
| `npm run test:integration`                                                                       | migraciones, repositorios SQL, paridad ETL, E2E con BD                                  | BD de prueba; Python real opcional |
| `ML_RUN_REAL_INTEGRATION=1 ML_REAL_SERVICE_URL=… ML_REAL_SERVICE_KEY=… npm run test:integration` | + cliente y E2E contra FastAPI real                                                     | instancia Python de desarrollo     |
| `ML_CONTRACT_SOURCE_PATH=…/ml-internal-v1.openapi.json npm run test:contract`                    | + paridad con el contrato del repo Python vivo                                          | checkout Python                    |
| `npm run test:coverage`                                                                          | cobertura (umbral 85 % líneas / 80 % ramas) de unit+contract+e2e → `coverage/lcov.info` | nada                               |
| `npm run test:coverage:all`                                                                      | cobertura incluyendo integración → `coverage/lcov-all.info`                             | BD de prueba                       |
| `RUN_PERFORMANCE=1 npm run test:performance`                                                     | benchmark → `reports/performance/*.json`                                                | BD de prueba (+ Python opcional)   |
| `npm run test:db:stop`                                                                           | detiene el contenedor de prueba (tmpfs: se descartan los datos sintéticos)              | —                                  |
| `npm run check`                                                                                  | typecheck (src+tests) + format:check + `npm test` + build                               | nada                               |

Un SKIP se informa como SKIP: cada suite opt-in no ejecutada registra un caso `# SKIP` con su motivo
(`tests/helpers/ReportSkipped.ts`). Con la BD de prueba apagada, `test:integration` informa 9 SKIP y 0 PASS.

## Resultados ejecutados (10-10-2026, macOS arm64, Node 24.20.0)

| Suite                                                          | Tests | PASS | FAIL |                    SKIP |
| -------------------------------------------------------------- | ----: | ---: | ---: | ----------------------: |
| `test:unit`                                                    |   161 |  161 |    0 |                       0 |
| `test:contract` (sin repo vivo)                                |     7 |    6 |    0 | 1 (paridad viva opt-in) |
| `test:contract` (con `ML_CONTRACT_SOURCE_PATH`)                |     7 |    7 |    0 |                       0 |
| `test:e2e`                                                     |    30 |   30 |    0 |                       0 |
| `npm test` (unit+contract+e2e)                                 |   198 |  197 |    0 |                       1 |
| `test:integration` (BD de prueba, sin Python real)             |    29 |   27 |    0 |         2 (Python real) |
| `test:integration` (BD de prueba + Python real 127.0.0.1:8002) |    33 |   33 |    0 |                       0 |
| `test:performance` (RUN_PERFORMANCE=1 + Python real)           |     4 |    4 |    0 |                       0 |

Cobertura (Node `--experimental-test-coverage`, solo archivos cargados):
`npm run test:coverage` 98,32 % líneas / 94,34 % ramas / 98,20 % funciones (umbral superado);
`test:coverage:all` (con integración y Python real) 98,10 % / 93,10 % / 97,83 % sobre 157 archivos.
**Limitación honesta:** la cobertura nativa de Node no cuenta archivos nunca cargados; los no
cargados son interfaces/tipos (sin código ejecutable), entrypoints (`index.ts`, `Server.ts`,
clientes Sequelize globales), CLI (`MigrateApp.ts`, `MigrateFlow.ts`) y la migración FLOWww
preexistente. Los repositorios Sequelize solo se cubren con `test:coverage:all`.

## Matriz de escenarios (resumen; detalle por HU en `acceptance_matrix.md`)

- **RiskFeaturesBuilder (§11.3):** 24 escenarios + coherencia de contadores en
  `tests/unit/modules/ReservationRisk/Shared/calculation/RiskFeaturesBuilder.test.ts`; paridad con
  ETL 13/14 reales en `tests/integration/modules/ReservationRisk/EtlFeatureParity.test.ts`.
- **Cliente Python (§11.4):** mock HTTP en loopback (`MlPredictionClient.test.ts`): rutas, cabeceras,
  19 claves, 401/413/429/503, 200 malformado/NaN/fuera de rango, timeout sin reintento, conexión
  rechazada, backpressure local, circuit breaker, batch con índices corruptos, logs sin secretos,
  redirecciones; validador (`MlContractValidator.test.ts`) con SHAP RF/XGB y tolerancias; real (opt-in).
- **SQL e idempotencia (§11.5):** listado (estados, período Lima, sede, alcance, NULLS LAST, keyset,
  sin N+1, READ ONLY, statement_timeout, sin migraciones), historial (`<` estricto, aislamiento,
  índice), almacén ml (concurrencia 6×, compare tras single, constraints, inmutabilidad).
- **Seguridad:** 401 uniforme en las 7 rutas de negocio, antes de validar; credencial duplicada;
  request-id opaco; 413; sin CORS; sin secretos/stack en respuestas y logs; inyección en
  sort/modelKey/clinicId/cursor ⇒ 400/422; IDs BIGINT como string; sin `clientId` en HU-06.
- **Arquitectura (§11.2):** `tests/unit/architecture/ModuleBoundaries.test.ts` (escáner léxico de
  imports sin comentarios; TypeScript 7 nativo no expone API de AST en JS).

## Dependencias de test

Ninguna nueva: `node:test`, `tsx`, `ajv` (ya en dependencias) para el OpenAPI, `pg`/Sequelize
existentes, Docker para la BD de prueba. Se descartaron Vitest, Testcontainers y c8 por no ser
necesarios.
