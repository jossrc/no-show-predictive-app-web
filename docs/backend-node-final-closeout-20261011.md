# Cierre técnico del backend Node/Fastify — 2026-10-11

**Backend técnico completado bajo PostgreSQL solo lectura. NO es un sistema aprobado para operación
comercial**: las probabilidades siguen `EXPLORATORY_NOT_VALIDATED`, la banda experimental es
`RESEARCH_PROVISIONAL` (`approvedBy=null`), `riskLevel` operativo es `null` y `operationalUseAllowed=false`.

## 1. Repositorios y estado

| Repo                          | Rama                                | SHA antes      | SHA después                              | Cambios                                                              |
| ----------------------------- | ----------------------------------- | -------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| no-show-predictive-app-be     | `feature/sprint-01-core-predictivo` | `80992c44f357` | `80992c44f357` + working tree sin commit | 96 archivos modificados, 58 nuevos (sin commit/push, por indicación) |
| depi-noshow-ml (solo lectura) | `main`                              | `b0e11893ffff` | igual, sin cambios                       | —                                                                    |
| no-show-predictive-app-fe     | `main`                              | `bfd3f20a`     | igual, sin cambios                       | —                                                                    |

`PROMPTS/` (sin seguimiento, del usuario) se preservó intacto.

## 2. Cambios por fase

**Fase 0 — seguridad PostgreSQL.** `ReadOnlySqlGuard` (envuelve `sequelize.query`; bloquea DML, DDL,
GRANT/REVOKE, `FOR UPDATE`, CTE con DML, `SELECT INTO`, multi-sentencia, `set_config`/`nextval`/locks,
`EXPLAIN ANALYZE`, `SET` de sesión) + `options=-c default_transaction_read_only=on` en el cliente runtime.
`migrate:app` (salvo `--dry-run`, que usa sesión read-only) y `migrate:flow` bloqueados sin autorización
expresa. Línea base en `reports/node-closeout/phase-0-baseline.md` (local).

**Fase 1 — cliente Python v2.** Contratos v2 copiados con SHA-256 anclado; Zod estricto
(`MlResearchContractSchemas.ts`), integridad y cruce con catálogo (`MlResearchContractValidator.ts`),
`HttpMlPredictionClient.getResearchPolicy/predictResearch/compareResearch` (rutas exactas, misma clave,
timeouts, limitador, circuito), `CachedResearchPolicyCatalog`, `MlResearchPolicyUnavailableException`
(503 `RESEARCH_RISK_POLICY_NOT_READY`, sin degradar el circuito v1). Goldens v2 **reales** capturados
de Python (entradas sintéticas) y del informe de rollback de Python (UNAVAILABLE/503).

**Fase 2 — banda experimental.** Modelo `ExperimentalRisk` separado de `RiskLevelPolicy`; `ModelScore`
transporta `experimentalRisk`, `modelHashSha256`, `scoringApiVersion`. `RequestReservationPrediction`
usa v2 cuando `ML_RESEARCH_RISK_ENABLED=true` (por defecto), exige la política (503 si no), verifica cada
respuesta contra la política publicada (502 y nada persistido si discrepa), idempotencia por política y
single-flight en proceso. HTTP aditivo (ver §4). Listado con `experimentalRiskLevel` y
`sort=experimentalRisk` por modelo, política vigente firmada en el cursor.

**Fase 3 — persistencia permitida.** Almacén SQLite local (`node:sqlite`) detrás de los puertos
existentes (`SqliteBookingSnapshotRepository`, `SqlitePredictionResultRepository`) y del nuevo
`ReservationScoreReader`. `SequelizeReservationRepository` pasa a ser **fuente** (`ReservationSource`)
sin `ml.*`; `ScoredReservationRepository` compone fuente + almacén con ranking global en dos fases.
Proveedores `SYNTHETIC_DEMO_ONLY` (reservas, evidencia, historial) desde `SyntheticDemoDataset.ts`.
`npm run store:status|store:backup`. Adaptadores PostgreSQL `ml` preservados aislados (no conectados,
fail-closed ante v2).

**Fase 4 — auditoría de evidencia.** §6. Código: aviso `WEEKDAY_ABSENT_FROM_TRAINING_DATA` (domingo),
sin reetiquetar. Ningún subgrupo real acredita evidencia ⇒ sin nuevo `BookingEvidenceSource` real.

**Fase 5 — API para Next.js.** `GET /api/v1/ml/research-risk-policy`, `GET /api/v1/health/predictive-store`,
campos aditivos, OpenAPI/Scalar actualizados (versión `1.1.0-research-risk-v2`, ejemplo real sintético).

**Fase 6 — pruebas.** §7. **Fase 7 — documentación.** README, `.env.example`, ADR-006/007, notas en
ADR-004/005, `docs/sprint-01/*` (api_contract con handoff FE, database, source_inventory, feature_lineage,
ml_integration, testing, acceptance_matrix, implementation_report).

## 3. Almacén local SQLite (migración `001`)

`.local/predictive-store/<modo>.sqlite` (0700/0600, Git-ignored), ligado a su modo; WAL,
`synchronous=FULL`, FK, defensivo. Tablas `STRICT` con UNIQUE `(reservation_id, snapshot_hash)` y
`(snapshot_id, model_key, model_version, research_policy_key)`, CHECKs (p∈[0,1], operativo=0,
`risk_level` solo aprobado, banda todo-o-nada, `0<low<high<1`, algoritmo↔modelo) y triggers sin
UPDATE/DELETE. Durabilidad tras reinicio probada (unit, E2E y Python real). Decisión: `node:sqlite`
evita dependencias nativas (`better-sqlite3`) y es síncrono, lo que hace atómicas y cortas las
transacciones dentro del proceso.

## 4. APIs nuevas/aditivas

Nuevas: `GET /api/v1/ml/research-risk-policy`, `GET /api/v1/health/predictive-store`. Aditivos en
`/reservations` (query `experimentalRiskLevel`, `sort=experimentalRisk`; `experimentalRiskPolicy`,
`operational/experimentalClassificationUnavailable`, `risk.experimentalRisk`, `experimentalPolicyCurrent`),
`/reservations/:id` (`scores[].experimentalRisk`), `/risk` y POST (`models[].experimentalRisk`,
`modelHashSha256`, `scoringApiVersion`, `classificationBasis`, `experimentalRiskNotice`), `/risk/factors`
(`persistedScore.experimentalRisk`), `/ml/models` (`experimentalRiskPolicy`). Errores nuevos: 503
`RESEARCH_RISK_POLICY_NOT_READY`, 422 `RANKING_CANDIDATES_EXCEEDED`. Ningún campo existente cambió de tipo;
`classificationUnavailable` ahora es `true` solo si no hay clasificación operativa **ni** experimental.
Guía FE y ejemplo completo: `docs/sprint-01/api_contract.md` §«Actualización 2026-10-11».

Ejemplo real sintético (`experimentalRisk` RF, reserva sintética 900000000101005 ≙ `examples/prediction_compare.json`):

```json
{
  "level": "HIGH",
  "label": "Alto (exploratorio)",
  "status": "RESEARCH_PROVISIONAL",
  "classificationBasis": "RESEARCH_PROVISIONAL",
  "policyId": "random_forest_full_v1_tertiles_202604_202605",
  "policyVersion": "research_risk_v1_1",
  "policyHash": "1d58ce962e899b758275f7191244225e8c970cf2db9661ffcb21be9b63a4ce74",
  "lowUpperThreshold": 0.302192334412,
  "highLowerThreshold": 0.460052607619,
  "boundaryRule": "LOW:p<t_low;MEDIUM:t_low<=p<t_high;HIGH:p>=t_high",
  "meaning": "relative_score_band_not_validated_absolute_risk",
  "scoreSpace": "raw_probability_no_show",
  "approvedBy": null,
  "operationalUseAllowed": false
}
```

(score RF `0.6976400433344135`, XGB `0.9159286618232727` HIGH con política `208c706d…7032`).

## 5. 19 predictoras inalteradas

Mismos nombres/orden (`PREDICTOR_COLUMNS`, contrato v1 y v2 verificados por test), `BOOKING_BASELINE_V1`,
`booking_creation`, sin claves extra. El E2E con doble estricto demuestra que el builder real produce
**exactamente** las 19 predictoras de los 5 ejemplos públicos de Python a partir del dataset sintético.

## 6. Auditoría read-only y población elegible (corte 2026-10-12T02:03Z; réplica 2026-10-07)

`diary_det` sin columnas temporales; `DiaryGStamp=DiaryGCreated` 0; Group/Mult vacíos; eventos solo
`RESCHEDULED` (259.045, 24 enlaces rotos); sin metadatos en eventos/servicios; orden de `DiaryID`
consistente pero no probatorio. Pipeline runtime: **8.887 FUTURE, 0 elegibles**; 8.887 sin captura de
servicios, 4.995 catálogo, 1.062 reprogramadas, 1.048 cliente; 3.059 bloqueadas solo por la captura de
servicios. Domingos: 0 en entrenamiento y 0 futuros; ISODOW coincide en 213.873 filas.

## 7. Pruebas ejecutadas (entorno: macOS arm64, Node 24.20.0, Python vivo en :8001)

| Comando                                            | Exit | Resultado                                                                                                                                                                |
| -------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| línea base `npm test` (antes)                      | 0    | 198 tests, 197 pass, 1 skip                                                                                                                                              |
| `npm run typecheck`                                | 0    | sin errores (src + tests)                                                                                                                                                |
| `npm run format:check`                             | 0    | dentro de `npm run check`                                                                                                                                                |
| `npm run test:unit`                                | 0    | 218/218                                                                                                                                                                  |
| `npm run test:contract`                            | 0    | 13 pass + 2 skip opt-in; con `ML_CONTRACT_SOURCE_DIR/PATH`: 15/15                                                                                                        |
| `npm run test:e2e`                                 | 0    | 43/43                                                                                                                                                                    |
| `npm run build`                                    | 0    | `tsc` OK                                                                                                                                                                 |
| `npm run check`                                    | 0    | 276 tests, 274 pass, 0 fail, 2 skip (opt-in)                                                                                                                             |
| `npm run test:coverage`                            | 0    | 97,82 % líneas, 92,95 % ramas                                                                                                                                            |
| `npm run test:integration` (+ Python real)         | 0    | 21: 13 pass, 0 fail, **8 SKIP** (BD PostgreSQL de prueba no levantada)                                                                                                   |
| Smoke real `npm run dev` (READ_ONLY)               | —    | `/docs` 200, 13 rutas OpenAPI, health ml/store 200, 401 sin clave, listado real 100 filas `NOT_SCORABLE`, POST 409, factores 409, `riskLevel=HIGH` 409, ID malicioso 400 |
| Instancia `SYNTHETIC_DEMO_ONLY` real + Python real | —    | 5 POST 201 con bandas publicadas; orden experimental XGB correcto; SHAP XGB aditividad 1.1617096333793597e-06                                                            |

Logs del servidor revisados: sin `ML_SERVICE_KEY`, sin credencial interna, sin contraseña, sin
predictoras ni fecha de nacimiento. Evidencias: `reports/node-closeout/*` (local, no versionado).

## 8. Evidencia de que PostgreSQL no se modificó

Huellas (solo SELECT) antes/después de auditoría, smoke y elegibilidad: `pg_stat_user_tables`
(ins/upd/del por esquema), `pg_stat_database` (`tup_inserted/updated/deleted`), conteos de 6 tablas,
`ml` con 0 tablas y mismo arranque del servidor: **idénticos** (`reports/node-closeout/pg-fingerprint-*.json`).
Las fases previas solo emitieron SELECT en sesiones `read_only` (el servidor rechazaría cualquier
escritura) y el guard bloqueó en prueba INSERT/CTE DELETE/FOR UPDATE/CREATE/`; DROP` antes de enviarlos.
No se ejecutaron migraciones, seeds, ni acciones Docker.

## 9. Matriz de aceptación final

| #   | Criterio                                                      | Resultado          | Evidencia                                                               |
| --- | ------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------- |
| 1   | PostgreSQL READ ONLY sin mutaciones                           | PASS               | guard + sesión read-only; huellas idénticas; `ReadOnlySqlGuard.test.ts` |
| 2   | `npm run dev` arranca, `/docs` carga                          | PASS               | smoke real: `/docs` 200, OpenAPI 13 rutas                               |
| 3   | RF/XGB detectados                                             | PASS               | `/api/v1/ml/models` real; `RealMlService.test.ts`                       |
| 4   | v2 risk-policy autenticado, hashes exactos                    | PASS               | `RealMlResearchService.test.ts`; endpoint Node                          |
| 5   | Single RF v2 + `experimentalRisk`                             | PASS               | `RealMlResearchService.test.ts`; unit                                   |
| 6   | Single XGB v2 + `experimentalRisk`                            | PASS               | ídem                                                                    |
| 7   | Compare v2 ambas identidades/bandas, sin winner/ensemble      | PASS               | integración real + validador                                            |
| 8   | `riskLevel` null, `operationalUseAllowed=false`               | PASS               | schemas `enum:[false]`, CHECK SQLite, E2E                               |
| 9   | v1 inferencia/compare compatibles                             | PASS               | `RealMlService.test.ts`; v1 vs v2 mismo score                           |
| 10  | v1 batch íntegro                                              | PASS               | `RealMlService.test.ts` (batch) + unit cliente                          |
| 11  | v1 SHAP RF/XGB con unidades                                   | PASS               | integración real (RF prob., XGB log-odds)                               |
| 12  | Snapshot 19 features, verificable o bloqueado                 | PASS               | builder/contrato; doble estricto; reales bloqueados                     |
| 13  | Historial as-of sin futuros ni cancelaciones                  | PASS               | tests builder 16/18/23/24; sintético                                    |
| 14  | Aislamiento sintético/real                                    | PASS               | archivo por modo + `store_meta`; proxy PG prohibido; evidencia por modo |
| 15  | SQLite almacena y sobrevive reinicio                          | PASS               | unit, E2E y Python real                                                 |
| 16  | 6 POST concurrentes, política versionada                      | PASS               | 1 inferencia, 1 run, 2 scores (fake y real)                             |
| 17  | Listado/detalle PG solo lectura + store local                 | PASS               | `ReservationSql` sin `ml.*`; guard test; smoke real                     |
| 18  | Ranking/filtros experimentales exactos por modelo             | PASS               | `ScoredReservationRepository.test.ts`; E2E                              |
| 19  | Cursor/paginación y filtros clínica/fecha/estado              | PASS               | paginación 1..N; cursor firmado; scope                                  |
| 20  | Reales NOT_SCORABLE con razones; subgrupo solo si evidenciado | PASS (0 elegibles) | `phase-4-eligibility-runtime.json`                                      |
| 21  | Salud y errores 401/409/422/429/503                           | PASS               | E2E y unit cliente                                                      |
| 22  | Credenciales protegidas, scopes, sin PII en logs              | PASS               | revisión de logs; E2E; `InternalApiGate.test.ts`                        |
| 23  | typecheck y format:check                                      | PASS               | `npm run check`                                                         |
| 24  | test:unit                                                     | PASS               | 218/218                                                                 |
| 25  | test:contract                                                 | PASS               | 13 + 2 opt-in (15/15 con paridad)                                       |
| 26  | test:e2e                                                      | PASS               | 43/43                                                                   |
| 27  | build                                                         | PASS               | exit 0                                                                  |
| 28  | `npm run check`                                               | PASS               | exit 0                                                                  |
| 29  | Smoke Node↔Python REAL                                        | PASS               | integración real + procesos reales                                      |
| 30  | Runbook y handoff FE                                          | PASS               | README, `api_contract.md`                                               |

Limitación externa: las 8 pruebas de integración contra la BD PostgreSQL **de prueba** quedaron SKIP
(contenedor `depi_noshow_test` no levantado para no depender de Docker); se adaptaron y compilan.
Reproducir: `npm run test:db:up && ML_RUN_REAL_INTEGRATION=1 … npm run test:integration`.

## 10. Riesgos científicos (no son bugs)

- Bandas = terciles relativos del score de abril–mayo; HIGH ≈ 26–29 % de no-show observado en junio;
  junio no es evaluación independiente. Sin calibración servida ni umbrales comerciales.
- Snapshots históricos y disponibilidad de labels sin acreditar; transición comercial jun–jul.
- El RF de Python varía 1–2 ULP entre llamadas (n_jobs): no afecta bandas salvo en la frontera exacta.
- Edad y sexo pueden aparecer como factores SHAP: no deben motivar trato diferenciado.
- Para puntuar reservas reales se necesita una captura fechada al reservar (fuente autorizada); hoy 0
  reservas reales son elegibles.
