# Sprint 02 · Implementación backend (Optimización Operativa)

Rama `feature/sprint-02`, base `cfaa20e` (merge de Sprint 01). Alcance: backend Node.js de HU-06,
HU-07 y HU-08 + migración obligatoria de la persistencia a PostgreSQL (ADR-008). **No se implementó
frontend.** Pantallas y criterios de UI quedan para `no-show-predictive-app-fe`
([`frontend-handoff.md`](frontend-handoff.md)).

## 1. Arquitectura

Nuevo módulo vertical `src/modules/OperationalOptimization/` (Screaming Architecture + Vertical
Slices, mismo patrón que Sprint 01): una carpeta por caso de uso con `application/{input,result}` y
`presentation/http/{handler,request,response,route,schema}`; `Shared/` con modelos, reglas, errores
(una excepción por archivo), puertos, adaptadores `postgres/`, HTTP y paginación;
`OperationalOptimizationModule.ts` como composition root. Se registra en `RegisterModules` dentro
del contexto protegido por `InternalApiKeyGuard` bajo `/api/v1`.

| Slice                           | Ruta                                                | HU  |
| ------------------------------- | --------------------------------------------------- | --- |
| `EnableOverbooking`             | `POST /reservations/:id/overbooking-authorizations` | 06  |
| `GetOverbookingAuthorization`   | `GET /reservations/:id/overbooking-authorization`   | 06  |
| `ListOverbookingAuthorizations` | `GET /overbooking-authorizations`                   | 06  |
| `RecordAttendanceOutcome`       | `POST /reservations/:id/attendance-outcomes`        | 07  |
| `GetAttendanceOutcome`          | `GET /reservations/:id/attendance-outcome`          | 07  |
| `ListAttendanceOutcomes`        | `GET /attendance-outcomes`                          | 07  |
| `RecordSpaceRecoveryOutcome`    | `POST /reservations/:id/space-recovery-outcomes`    | 08  |
| `GetSpaceRecoveryOutcome`       | `GET /reservations/:id/space-recovery-outcome`      | 08  |
| `ListSpaceRecoveryOutcomes`     | `GET /space-recovery-outcomes`                      | 08  |

Dependencias entre módulos (verificadas por `ModuleBoundaries.test.ts`):
`OperationalOptimization → Reservations, ReservationRisk` (solo sus `Shared`). Para enriquecer el
detalle (`Reservations`) y el listado (`ReservationRisk`) sin ciclos, el modelo
`ReservationOperationalStatus` y el puerto `ReservationOperationalStatusReader` viven en
`Reservations/Shared`, y su adaptador PostgreSQL en `OperationalOptimization`.
`ScoredReservationRepository` lo usa por lote en la misma fase que los scores (sin N+1).

Reutilización (sin duplicar): `loadAccessibleReservation` (404 + alcance de sede),
`ReservationCursor` (cursor opaco firmado), `resolveListPeriod` (movido de la feature privada
`ListReservationRisks` a `Reservations/Shared/validation`), `ReservationIdParamsSchema`,
`ErrorResponseSchema`, `ConflictException`/error handler central, `Clock`, `LimaTime`.

Validación de cuerpos: `src/app/http/validation/StrictValidatorCompiler.ts` (Ajv sin coerción),
aplicado solo a los tres POST de Sprint 02, porque el Ajv por defecto de Fastify convierte `"true"`
o `1` en booleanos. Los errores mantienen el formato `REQUEST_VALIDATION_ERROR`.

## 2. Persistencia 100 % PostgreSQL

Detalle completo en [`postgresql-only-migration.md`](postgresql-only-migration.md). Resumen:

- `src/infrastructure/database/postgres/`: `PredictiveAppDatabase` (pool `pg` dedicado, transacciones
  cortas, errores seguros), `PredictiveAppSqlGuard`, `PredictiveAppMigrationRunner`,
  `AdditiveMigrationGuard`.
- `src/modules/ReservationRisk/Shared/persistence/postgres/`: `PostgresPredictiveStore` (verificación
  de arranque + health), `PostgresBookingSnapshotRepository`, `PostgresPredictionResultRepository`
  (también implementa el nuevo puerto `PredictionRunReader`), `PostgresReservationScoreReader`,
  `PostgresRows`, `LegacyPredictiveStoreImporter`.
- Puertos de Sprint 01 sin cambios de firma (`BookingSnapshotRepository`,
  `PredictionResultRepository`, `ReservationScoreReader`, `ReservationRepository`); nuevo puerto
  `PredictionRunReader` (lectura de un run por `predictionRunId`).
- Migraciones `migrations/postgres/predictive_app/001_*.sql`, `002_*.sql` y `provisioning/roles.sql`.
- CLI: `store:migrate`, `store:status` (PostgreSQL), `store:import-legacy`. Retirado `store:backup`.
- Config: `APP_DB_*_POSTGRES`, `APP_DB_STATEMENT_TIMEOUT_MS`, `APP_DB_ALLOW_PRIVILEGED_ROLE`;
  retirado `PREDICTIVE_STORE_SQLITE_PATH`. `src/index.ts` abre y verifica el almacén (await) y lo
  cierra en `onClose`; `Server.stop()` cierra la app (pool de la app) y luego la fuente.

## 3. Reglas de negocio implementadas

| Regla                                                                                                                                                                                                                                  | Versión                        | Dónde                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| Elegibilidad HU-06: SCHEDULED, cita futura (Clock), último score del modelo con banda experimental HIGH bajo la política research vigente; por modelo, sin ensemble; la marca exige el run del último score (vista no desactualizada). | `overbooking_eligibility_v1`   | `Shared/rules/OverbookingEligibility.ts`, `EnableOverbooking.ts` |
| Cita finalizada HU-07: no cancelada, inicio vencido y (PAST en ETL o fin programado FLOWww vencido). Sin fin acreditado no se infiere.                                                                                                 | `appointment_finished_rule_v1` | `Shared/rules/AppointmentFinished.ts`                            |
| Comparación HU-07: `p >= 0.5` ⇒ inasistencia predicha, por modelo; descriptiva y provisional.                                                                                                                                          | `binary_outcome_threshold_v1`  | `Shared/rules/BinaryOutcomeComparison.ts`                        |
| Sin fuga temporal HU-07: solo runs de la misma reserva/modo con todos sus scores ≤ inicio de la cita.                                                                                                                                  | —                              | `RecordAttendanceOutcome.ts`                                     |
| HU-08 exige autorización HU-06 previa; true/false explícitos; no depende de HU-07.                                                                                                                                                     | —                              | `RecordSpaceRecoveryOutcome.ts`                                  |
| Idempotencia: reintento idéntico ⇒ 200 `replayed`; distinto ⇒ 409; nunca UPDATE/DELETE.                                                                                                                                                | —                              | casos de uso + UNIQUE/`ON CONFLICT DO NOTHING`                   |

`riskLevel` operativo sigue `null` y `operationalUseAllowed=false`; la marca HU-06 es una
autorización manual para análisis, no una acción automática sobre la agenda.

## 4. Decisiones técnicas e incertidumbres

1. **Comparación HU-07**: la tesis no define el umbral; se usa 0,5 como convención técnica
   **provisional**, versionada y guardada por registro; no es validación científica ni redefine las
   bandas. Un cambio futuro debe crear una nueva versión de regla, sin recalcular el histórico.
2. **Banda usada por HU-06**: la experimental (`RESEARCH_PROVISIONAL`) del modelo elegido por el
   usuario, porque no existe política operativa aprobada. Si RF y XGB discrepan, solo cuenta el
   modelo seleccionado y queda trazado (`modelKey`, `predictionRunId`, `predictionResultId`, hash y
   versión de política, probabilidad y `scoredAt` al autorizar).
3. **Fin de la cita**: el ETL de la base real es una foto (clasificación desactualizada). Para no
   bloquear HU-07 indefinidamente ni inventar finalizaciones, se acepta el fin programado registrado
   en FLOWww (fuente de solo lectura). Las citas `PAST` canceladas no son distinguibles con la
   clasificación expuesta (el ETL oculta el detalle de PAST); el registro es siempre una decisión
   humana explícita y una cancelación futura sí se rechaza.
4. **Autoría**: sin login, se registra `actorKind=INTERNAL_SERVICE`, `actorUserId=null` y el
   `requestId`. Pendiente HU-21/HU-22 para identificar supervisor/recepcionista.
5. **Notas libres en HU-08**: no se implementaron (opcionales en la guía) para no capturar datos
   personales en texto libre.
6. **Estado de gestión `null`**: si el almacén no responde en el listado, los tres objetos son
   `null` («desconocido»), nunca «sin registros».

## 5. Archivos

Creados (código): `src/modules/OperationalOptimization/**` (9 slices + Shared),
`src/infrastructure/database/postgres/*`, `src/modules/ReservationRisk/Shared/persistence/postgres/*`,
`src/modules/ReservationRisk/Shared/persistence/PredictionRunReader.ts`,
`src/modules/Reservations/Shared/{models/ReservationOperationalStatus.ts, persistence/ReservationOperationalStatusReader.ts, http/OperationalStatusHttp.ts}`,
`src/app/http/validation/StrictValidatorCompiler.ts`,
`src/app/cli/{MigratePredictiveStore,ImportLegacySqliteStore,PredictiveStoreCliConnection}.ts`,
`migrations/postgres/predictive_app/**`.

Modificados (Sprint 01, cambios acotados): composición (`src/index.ts`, `src/app/*`), config
(`PredictiveConfig`, `EnvironmentSchema`), health del almacén, `ScoredReservationRepository` (+
lector de estado), `GetReservation` y `ListReservationRisks` (campos aditivos), esquemas HTTP,
comentarios/descripciones que mencionaban SQLite, `PersistenceUnavailableException` (motivos
nuevos), `MigrateApp` (marcado obsoleto), `BookingSnapshotResolver.ts` (solo formato Prettier
preexistente). `ResolveListPeriod.ts` movido a `Reservations/Shared/validation`.

Eliminados (tras verificar el reemplazo; quedan en git): `src/infrastructure/database/sqlite/SqliteDatabase.ts`,
`src/modules/ReservationRisk/Shared/persistence/sqlite/*` y su prueba unitaria.

Pruebas y documentación: ver [`acceptance-and-tests.md`](acceptance-and-tests.md).
