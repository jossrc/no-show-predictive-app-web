# Sprint 02 · Criterios de aceptación, tareas y pruebas

Resultados **reales** del 30/10/2026 (Node 24.20, PostgreSQL 18.4 de prueba en `:55432`, tmpfs).

## 1. Tareas Jira (backend) → implementación → evidencia

| Tarea                                         | Implementación                                                                                                         | Pruebas                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| S02-HU06-T01 reglas                           | `OverbookingEligibility.ts` (`overbooking_eligibility_v1`)                                                             | `OperationalRules.test.ts`, `OperationalUseCases.test.ts`         |
| S02-HU06-T02 persistencia                     | `ml.app_overbooking_authorizations` (002)                                                                              | `PostgresOperationalRepositories.test.ts`                         |
| S02-HU06-T03 lógica                           | `EnableOverbooking.ts`, `OverbookingEligibilityResolver.ts`                                                            | unit + E2E                                                        |
| S02-HU06-T04 API habilitación                 | `POST …/overbooking-authorizations`                                                                                    | `Sprint02OperationalFlow.test.ts`, `Sprint02DatabaseFlow.test.ts` |
| S02-HU06-T05 integración en reservas          | `overbooking` en `GET /reservations` y `/reservations/:id`                                                             | E2E + regresión Sprint 01                                         |
| S02-HU06-T06 API consulta                     | `GET …/overbooking-authorization`, `GET /overbooking-authorizations`                                                   | E2E                                                               |
| S02-HU06-T09/T10 pruebas/evidencias           | este documento                                                                                                         | —                                                                 |
| S02-HU07-T01 reglas                           | `AppointmentFinished.ts`, `BinaryOutcomeComparison.ts`                                                                 | `OperationalRules.test.ts` (borde 0,49/0,50)                      |
| S02-HU07-T02 persistencia                     | `ml.app_attendance_outcomes`, `ml.app_attendance_prediction_comparisons`                                               | repos PG                                                          |
| S02-HU07-T03 validación cita/predicción       | `AppointmentFinishedResolver`, `PredictionRunReader`                                                                   | unit + E2E                                                        |
| S02-HU07-T04/T05/T06 lógica, API, comparación | `RecordAttendanceOutcome`, `GetAttendanceOutcome`, `ListAttendanceOutcomes`                                            | E2E                                                               |
| S02-HU07-T09/T10                              | este documento                                                                                                         | —                                                                 |
| S02-HU08-T01..T05                             | `RecordSpaceRecoveryOutcome`, `GetSpaceRecoveryOutcome`, `ListSpaceRecoveryOutcomes`, `ml.app_space_recovery_outcomes` | unit + E2E + repos PG                                             |
| S02-HU08-T08/T09                              | este documento                                                                                                         | —                                                                 |
| Fuera de alcance                              | HU06-T07/T08, HU07-T07/T08, HU08-T06/T07 (frontend)                                                                    | handoff FE                                                        |

## 2. Criterios de aceptación → evidencia backend

| HU  | CA                                                        | Evidencia                                                                                                                                                                                         | Estado backend                                             |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 06  | CA1 opción visible con riesgo alto                        | `GET …/overbooking-authorization` ⇒ `eligibility.eligible` y candidatos por modelo (HIGH ⇒ true; MEDIUM/LOW/NOT_SCORED/cancelada/pasada ⇒ false con motivo).                                      | Cumplido a nivel API; la UI (mostrar botón) queda para FE. |
| 06  | CA2 registra «Habilitado para sobreasignación»            | POST ⇒ 201 `status=ENABLED`, `statusLabel`; fila en `ml.app_overbooking_authorizations`; 6 POST concurrentes ⇒ 1 fila.                                                                            | Cumplido                                                   |
| 06  | CA3 estado actualizado al consultar                       | Detalle, listado, GET dedicado y lista reflejan `ENABLED`, también tras **reiniciar el backend** (pool nuevo) en PostgreSQL.                                                                      | Cumplido                                                   |
| 06  | CA4 sin modificar FLOWww                                  | Solo INSERT en `ml.app_*` (guard + rol runtime sin UPDATE/DELETE); modo sintético con fuente PostgreSQL **prohibida** (`FORBIDDEN_POSTGRES`); `reservationStatus` intacto; sin llamadas a Python. | Cumplido                                                   |
| 07  | CA1 permite indicar asistió/no asistió en cita finalizada | Solo `ATTENDED`/`NO_SHOW`; antes/durante la cita ⇒ 409 `APPOINTMENT_NOT_FINISHED`; cancelada ⇒ 409; fin no acreditado ⇒ 409.                                                                      | Cumplido                                                   |
| 07  | CA2 asociado a la predicción                              | `predictionRunId` obligatorio; FK compuestas al run y resultados de la MISMA reserva; run ajeno ⇒ 409; score posterior a la cita ⇒ 409.                                                           | Cumplido                                                   |
| 07  | CA3 muestra si coincidió                                  | `comparisons[]` por modelo con `predictedNoShow`, `observedNoShow`, `matchesPrediction`, regla y umbral; RF/XGB pueden diferir.                                                                   | Cumplido (descriptivo, umbral provisional)                 |
| 07  | CA4 almacenado para evaluación                            | Registros inmutables + `GET /attendance-outcomes` paginado.                                                                                                                                       | Cumplido                                                   |
| 08  | CA1 permite indicar si se recuperó                        | POST con `spaceRecovered` booleano estricto, solo con gestión HU-06.                                                                                                                              | Cumplido                                                   |
| 08  | CA2 guarda Sí/No asociado al horario                      | `true`/`false` persistidos y devueltos como tales (`false` ≠ `null`); FK a la autorización del mismo horario.                                                                                     | Cumplido                                                   |
| 08  | CA3 impide sin gestión previa                             | 409 `PREVENTIVE_ACTION_REQUIRED` y **cero INSERT** (verificado en memoria y en PostgreSQL).                                                                                                       | Cumplido                                                   |
| 08  | CA4 disponible para reportes                              | `GET /space-recovery-outcomes` paginado + resumen en detalle/listado.                                                                                                                             | Cumplido                                                   |

No se declara cumplido ningún criterio de **interfaz**: se verificará al construir el frontend.

## 3. Pruebas nuevas

| Archivo                                                                                     | Tipo            | Qué cubre                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/unit/modules/OperationalOptimization/Shared/rules/OperationalRules.test.ts`          | unit            | Elegibilidad por modelo y todos sus motivos; umbral 0,49 vs 0,50; regla de cita finalizada (bordes exactos, PAST sin consultar fuente).                                                                            |
| `tests/unit/modules/OperationalOptimization/application/OperationalUseCases.test.ts`        | unit            | `PREDICTION_NOT_LATEST`, independencia RF/XGB, concurrencia, inmutabilidad de la marca ante scores posteriores, comparaciones distintas por modelo, fuga temporal, alcance de sede, HU-08 true/false/concurrencia. |
| `tests/unit/infrastructure/database/PredictiveAppGuards.test.ts`                            | unit            | Guard de la conexión de la app y guard de migraciones aditivas.                                                                                                                                                    |
| `tests/e2e/OperationalOptimization/Sprint02OperationalFlow.test.ts`                         | E2E HTTP        | Flujo completo HU-06→07→08, rechazos, contrato estricto (400 sin coerción, 401 antes de validar, 413, `requestId`), listados (Lima, sede, keyset, cursor firmado, 422), GET sin escrituras ni llamadas ML, 503.    |
| `tests/integration/e2e/Sprint02DatabaseFlow.test.ts`                                        | integración E2E | Composición REAL en modo sintético + PostgreSQL de prueba: elegibilidad, concurrencia, **reinicio** del backend, HU-07/08, inmutabilidad en BD, health.                                                            |
| `tests/integration/modules/OperationalOptimization/PostgresOperationalRepositories.test.ts` | integración     | FK que impiden cruzar reservas, ON CONFLICT con 6 concurrentes, rollback de transacción, CHECK de comparación, lector por lote, alcance y keyset.                                                                  |
| `tests/integration/modules/ReservationRisk/PostgresPredictiveStore.test.ts`                 | integración     | Sustituye la prueba SQLite: reinicio, fail-closed (modo, base, migración, identidad, rol privilegiado), idempotencia v1/v2, float64, inmutabilidad (guard, privilegios, triggers), CHECKs v2, lector de scores.    |
| `tests/integration/database/postgres/PredictiveAppMigrations.test.ts`                       | integración     | Runner con rol migrador no superusuario, idempotencia, checksum, colisión sin reemplazo, rechazo de migraciones destructivas.                                                                                      |
| `tests/integration/modules/ReservationRisk/LegacyPredictiveStoreImport.test.ts`             | integración     | Importación del histórico (dump plano, sin SQLite): orden FK, reconciliación, idempotencia, modo distinto rechazado, rollback total ante fila inválida.                                                            |

Pruebas de Sprint 01 adaptadas a PostgreSQL (misma semántica): `ExperimentalRiskSyntheticFlow`,
`Sprint01DatabaseFlow`, `Sprint01RealMlFlow`, `SyntheticLocalRealMlFlow`,
`SequelizeReservationRepository`, `Sprint01Performance`, `ScoredReservationRepository`,
`PredictiveConfig`, `ModuleBoundaries` (+ regla «sin SQLite en runtime» y migraciones aditivas).

## 4. Resultados ejecutados

| Comando                            | Resultado                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                | OK                                                                                                                                                                                                                                                                                                                                             |
| `npm run format:check`             | OK                                                                                                                                                                                                                                                                                                                                             |
| `npm test` (unit + contract + e2e) | **297 pass, 0 fail, 2 skipped** (los 2 skip son opt-in preexistentes de Python real)                                                                                                                                                                                                                                                           |
| `npm run build`                    | OK                                                                                                                                                                                                                                                                                                                                             |
| `npm run check`                    | OK (las cuatro etapas anteriores)                                                                                                                                                                                                                                                                                                              |
| `npm run test:coverage`            | OK, umbrales superados: **95,50 % líneas, 92,15 % ramas, 94,57 % funciones**                                                                                                                                                                                                                                                                   |
| `npm run test:integration`         | **51 pass, 4 fail, 4 skipped**. Los 4 fallos son **preexistentes** (idénticos en la línea base antes de cualquier cambio): 1 en `Sprint01DatabaseFlow` y 3 en `SequelizeBookingEvidenceSource` (expectativas de reprogramación desactualizadas tras el commit «Hacer funcionar los reprogramados»). Los 4 skip requieren Python real (opt-in). |
| OpenAPI (`NODE_ENV=development`)   | `/docs/openapi.json` con las 9 rutas nuevas bajo el tag _Operational optimization_; exportado en `docs/sprint-02/openapi.json`.                                                                                                                                                                                                                |

Notas: `test:coverage` no incluye integración (convención del repo); los adaptadores PostgreSQL de
HU-06/07/08 se cubren en `test:integration`. Las suites que persisten crean y eliminan una base
PostgreSQL desechable por suite y se reportan como SKIP si el contenedor de prueba no está arriba.
`test:performance` no se ejecutó en esta entrega.

## 5. Datos existentes intactos

- Base real: respaldo completo `pg_dump` previo; solo se crearon objetos nuevos `ml.app_*` e
  insertó el histórico importado (32/34/64). Conteos de `raw_flow`/`analytics` idénticos antes y
  después (ver `postgresql-only-migration.md` §6).
- SQLite legado: originales con SHA-256 idéntico antes/después; respaldo verificado.
- Ninguna prueba se conecta a la base real (`TestEnvironment` y `testDatabaseConfig` exigen una base
  cuyo nombre contenga `test`).
