# Sprint 01 — Informe de implementación

## Git

| Campo                       | Valor                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| Commit de partida           | `6484f9f1d4cea8b5c133af0d4cf1797914ec0bc9` (`main`, «migracion»)                                |
| Rama de trabajo             | `feature/sprint-01-core-predictivo` (sin commit ni push: pendiente de revisión del propietario) |
| Cambios previos del usuario | `PROMPTS/` y `bd/` sin seguimiento: preservados, no modificados                                 |
| Lockfile                    | Solo cambia `name` (`depi_tracking` → `no-show-predictive-app-web`); sin dependencias nuevas    |

## Línea base (antes de cambiar código)

`npm ci` OK · `typecheck` OK · `build` OK · `format:check` fallaba en 5 archivos preexistentes
(`docker-compose.yml`, `PROMPTS/…`, `README.md`, `Environment.ts`, `Logger.ts`) · `npm test`
apuntaba a `test/*.test.ts` (directorio vacío, sin tests).

## Archivos

- **Nuevos:** ~170 en `src/` (módulos `Reservations`, `ReservationRisk`, `ClientHistory`,
  `PredictionModels`, `Health/CheckMlService`; `infrastructure/http/ml`, `resilience`,
  `database/migrations`; `shared/time|security|identifiers|data`; `config/PredictiveConfig.ts`;
  `app/http/security|request`, `app/CreatePredictiveDependencies.ts`, `app/cli/MigrateApp.ts`),
  ~80 en `tests/`, `migrations/postgres/app/001_*`, `docker-compose.test.yml`, `tsconfig.test.json`,
  `.prettierignore`, `docs/sprint-01/*`, `docs/adr/*`.
- **Editados:** `BuildApp.ts`, `RegisterModules.ts`, `index.ts`, `HealthModule.ts`,
  `EnvironmentSchema.ts`, error handler (`NormalizedException`, `NormalizeException`,
  `GetHttpStatusFromException`, `GetPublicErrorMessage`, `PinoExceptionReporter`), `package.json`
  (nombre, scripts), `.env.example`, `.gitignore` (`docs/*` salvo `sprint-01` y `adr`; `reports/`),
  `README.md`. `Environment.ts`/`Logger.ts`: solo formato.
- **Intactos:** `FlowMigration`, `migrate:flow`, `migrations/postgres/001|002`, `docker-compose.yml`,
  rutas `/api/health/postgres|mysql`, reporteros de excepciones, conexiones Sequelize.

## Comandos ejecutados y resultado

| Comando                                                                | Resultado                                                                                                                                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` (src + tests)                                      | OK                                                                                                                                                                                |
| `npm run build`                                                        | OK (`dist/` sin tests)                                                                                                                                                            |
| `npm run format:check`                                                 | OK                                                                                                                                                                                |
| `npm test`                                                             | 198 tests: 197 PASS, 1 SKIP (paridad viva opt-in)                                                                                                                                 |
| `npm run test:contract` con `ML_CONTRACT_SOURCE_PATH`                  | 7/7 PASS (contrato idéntico al repo Python)                                                                                                                                       |
| `npm run test:integration` (BD de prueba + Python real 127.0.0.1:8002) | 33/33 PASS                                                                                                                                                                        |
| `npm run test:coverage`                                                | 98,32 % líneas / 94,34 % ramas (umbral 85/80)                                                                                                                                     |
| `RUN_PERFORMANCE=1 … npm run test:performance`                         | 4/4 PASS, cifras en `performance.md`                                                                                                                                              |
| Smoke real (solo lectura, puerto 3999, claves efímeras)                | 401 sin credencial; listado 5.554 reservas `NOT_SCORABLE`; `GET /risk` 200; `POST` 409; factores 409; historial 200                                                               |
| `npm audit --omit=dev`                                                 | 7 vulnerabilidades **preexistentes** (2 altas: `fastify` ≤5.12.4, `brace-expansion`; 5 moderadas: `fast-uri`, `moment`, `uuid` vía `sequelize`). No se aplicó `audit fix --force` |
| `git diff --check`                                                     | sin errores de espacios                                                                                                                                                           |

## Hallazgos corregidos durante la verificación

1. `EXISTS` sobre `appointment_events` provocaba `Seq Scan` (coste ≈115 k) → predicado del índice parcial + rama `diary_gen` indexada (≈580).
2. El cliente ML reenviaba propiedades extra en `batch` (Python 422) → cuerpos construidos campo a campo + test de regresión.
3. JIT de PostgreSQL costaba 70–120 ms por listado → `SET LOCAL jit = off` en lecturas (−66 % p50 con 100 k).
4. `GET /risk` respondía 503 si el schema `ml` no estaba migrado → lectura degrada a evaluación de evidencia (POST sigue en 503).
5. Suites opt-in omitidas no aparecían como SKIP → marcador explícito.
6. `prettier --write` alteró la copia del OpenAPI anclado (el test de SHA lo detectó) → copia restaurada y excluida de Prettier.

## Bloqueos y pendientes honestos

- **Semáforo / niveles:** sin política aprobada (`pending_validation`); `riskLevel=null`.
- **Snapshots reales:** 0 de 8.887 reservas futuras tienen evidencia temporal de servicios al reservar ⇒ `NOT_SCORABLE`. Requiere una captura fechada (sincronizador o carga HU-15, fuera de Sprint 01).
- **Migración `ml` en la BD real:** preparada y probada en BD de prueba; **no ejecutada** en `depi_noshow` (requiere autorización: `npm run migrate:app`).
- **Seguridad:** compuerta provisional; login/roles (HU-21/HU-22) pendientes.
- **Validación científica:** ROC-AUC ≥ 0,80 en test no acreditada; sin calibración; posible deriva por el cambio comercial jun–jul 2026; los 8 controles metodológicos siguen pendientes.
- **Dependencias:** se recomienda actualizar `fastify` a 5.12.5 (parche de seguridad) como cambio separado y revisado.
- **Frontend Next.js:** semáforo visual, modal SHAP y gráficos fuera de este repositorio.

## Pasos para Next.js

1. Consumir la API **desde el servidor** (Route Handlers/Server Actions) con `x-api-key`; nunca exponer la clave al navegador (no hay CORS).
2. Mostrar `percentageNoShow` con la etiqueta «estimación experimental, no calibrada»; tratar `null` como «no evaluada».
3. Ocultar/deshabilitar filtros por nivel mientras `classificationUnavailable=true`; mostrar «Niveles de riesgo pendientes de validación».
4. Pedir `/risk/factors` solo al abrir el detalle (una llamada por modelo) y mostrar `units` e `interpretation` (no causal).
5. Mostrar `notScorableReasons` cuando `predictionAvailability=NOT_SCORABLE`.

## Cierre técnico 2026-10-11

Ver [`../backend-node-final-closeout-20261011.md`](../backend-node-final-closeout-20261011.md): PostgreSQL
solo lectura con guard, almacén SQLite local, cliente Python v2 y banda experimental por modelo
(`experimentalRisk`), filtros/orden experimentales, modo sintético local y auditoría de evidencia.
