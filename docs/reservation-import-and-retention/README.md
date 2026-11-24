# Incorporación de reservas y gestión de retención — documentación técnica

Backend Fastify (`/api/v1`, credencial `x-api-key`). Todos los ejemplos usan datos **sintéticos**
(identificadores del rango `9000000…`).

## 1. Funcionalidades

| Capacidad                       | Endpoint                                            | Módulo              |
| ------------------------------- | --------------------------------------------------- | ------------------- |
| Incorporación masiva (CSV/XLSX) | `POST /api/v1/reservation-imports`                  | `ReservationImport` |
| Clientes prioritarios           | `GET /api/v1/retention/priority-clients`            | `CustomerRetention` |
| Exportación CSV                 | `GET /api/v1/retention/priority-clients/export`     | `CustomerRetention` |
| Registro de acción de retención | `POST /api/v1/reservations/{id}/retention-contacts` | `CustomerRetention` |

No se agregó un endpoint de consulta del lote: la respuesta del `POST` contiene el resultado
completo y el lote queda trazado en `ml.app_reservation_import_batches`.

## 2. Arquitectura e integración con lo existente

- **Sin listado paralelo.** `CompositeReservationSource` (Reservations) une la fuente principal
  (réplica `raw_flow`/`analytics` de solo lectura, o dataset sintético) con
  `PostgresImportedReservationSource` (tabla propia `ml.app_imported_reservations`), con los mismos
  filtros y el mismo keyset `(appointmentAt, reservationId)`. `GET /reservations`,
  `GET /reservations/{id}`, `GET …/risk`, `POST …/predictions` y los módulos de gestión existentes
  ven las reservas incorporadas sin cambios en sus casos de uso.
- **Procedencia.** `Reservation.origin` (`SOURCE` | `IMPORT`) e `importBatchId` se exponen de forma
  aditiva en el listado y el detalle. Si la fuente principal llega a registrar el mismo ID, prevalece
  la fuente y la reserva incorporada queda oculta (nunca se duplica).
- **Evidencia predictiva.** `CompositeBookingEvidenceSource` delega en `ImportedBookingEvidenceSource`
  cuando la réplica no conoce la reserva. Se reutilizan sin cambios `AssessBookingEvidence`,
  `BookingSnapshotResolver`, `RiskFeaturesBuilder` (19 predictoras `BOOKING_BASELINE_V1`) y la
  integración con Python. La importación **no** genera predicciones.
- **Retención.** `PriorityClientQuery` es la única definición de elegibilidad
  (`retention_priority_v1`) y la usan tanto el listado como la exportación. Reutiliza
  `ReservationRepository.list` (ranking global en el almacén, verificación en la fuente, sin N+1)
  con dos restricciones opcionales nuevas y genéricas: `onlyReservationIds` / `excludeReservationIds`.
- **Dependencias de módulos.** `ReservationImport → Reservations, ReservationRisk` y
  `CustomerRetention → Reservations, ReservationRisk` (declaradas en la prueba de arquitectura).

## 3. Contrato de importación `reservation_import_v1`

> No es el formato oficial de exportación del sistema de agendamiento. Es un contrato explícito de
> esta API construido con los **campos verificados de FLOWww** (`raw_flow.diary_gen`,
> `raw_flow.diary_det`) y con `cantidad_reprogramaciones` de la consulta operacional documentada.

Una fila = una reserva. Cabeceras sin distinguir mayúsculas; columnas no contractuales se ignoran
(no se almacenan) y se informan en `ignoredColumns`. Fechas y horas: **hora de pared de America/Lima**
(como FLOWww); se persisten y exponen en UTC.

| Columna                     | Oblig. | Formato                                                   | Uso                                     |
| --------------------------- | :----: | --------------------------------------------------------- | --------------------------------------- |
| `DiaryGID`                  |   Sí   | entero 1–18 dígitos, sin ceros a la izquierda (texto)     | identificador de la reserva             |
| `DiaryGClientID`            |   Sí   | ídem                                                      | debe existir en la fuente               |
| `DiaryGClinicID`            |   Sí   | entero 1–9 dígitos                                        | debe existir y estar en el alcance      |
| `DiaryGDate`                |   Sí   | `YYYY-MM-DD` o `DD/MM/YYYY` (o fecha de Excel)            | fecha de la cita                        |
| `DiaryGStart`               |   Sí   | `HH:MM` o `HH:MM:SS` (o hora de Excel)                    | inicio de la cita                       |
| `DiaryGEnd`                 |   No   | ídem                                                      | duración (vacío ⇒ `null`)               |
| `DiaryGCreated`             |   Sí   | `YYYY-MM-DD HH:MM[:SS]` o `DD/MM/YYYY HH:MM[:SS]`         | instante de reserva (`prediction_at`)   |
| `DiaryGNotAttended`         |   Sí   | `0` o `-1`                                                | `-1` ⇒ `CANCELLED`, `0` ⇒ `SCHEDULED`   |
| `DiaryGFWA`                 |   No   | `0` o `-1`                                                | `is_fwa` (vacío ⇒ `null`)               |
| `DiaryZoneIDs`              |   Sí   | IDs de producto separados por `\|` (1–50, con repetición) | líneas de servicio previstas            |
| `cantidad_reprogramaciones` |   Sí   | entero 0–1000                                             | copias FLOWww (evidencia temporal)      |
| `DiaryGDelayed`             |   No   | `0` o `-1`                                                | `-1` (copia histórica) ⇒ fila rechazada |
| `DiaryGLocked`              |   No   | `0` o `-1`                                                | `-1` (bloqueo) ⇒ fila rechazada         |
| `DiaryGTags`                |   No   | texto                                                     | tag `16` (borrador) ⇒ fila rechazada    |

Plantillas sintéticas (no oficiales):
[`templates/reservation_import_v1_template.csv`](templates/reservation_import_v1_template.csv) y
[`templates/reservation_import_v1_template.xlsx`](templates/reservation_import_v1_template.xlsx).

### Archivo

- `.csv`: UTF-8 (con o sin BOM), separador `,` o `;` (se detecta por la cabecera).
- `.xlsx`: se lee la **primera hoja**. Se rechazan libros con fórmulas, macros (`vbaProject.bin`,
  tipo _macroEnabled_), vínculos externos o conexiones. Nada se ejecuta ni se evalúa. Descompresión
  acotada (≤ 500 entradas, ≤ 64 MiB).
- `.xls`/OLE2 u otras extensiones: no admitidos. El contenido debe coincidir con la extensión.
- Un único archivo en el campo `file`; sin campos adicionales. Tamaño máximo
  `RESERVATION_IMPORT_MAX_FILE_BYTES` (5 MiB por defecto, máx. 20 MiB) y filas máximas
  `RESERVATION_IMPORT_MAX_ROWS` (5000 por defecto, máx. 20000).
- El archivo se procesa **en memoria**; nunca se escribe en disco ni se almacena. Solo se guarda su
  SHA-256 y tamaño.

### Validaciones por fila

Formato de cada campo; fin ≥ inicio; creación < cita; creación ≤ momento de procesamiento; cita
posterior al momento de procesamiento; no es copia/bloqueo/borrador; duplicados en el archivo
(copias idénticas ⇒ se conserva la primera; datos distintos ⇒ se rechazan todas); existencia en la
fuente (colisión de ID con cualquier fila de agenda); ya incorporada (mismo contenido ⇒
`ALREADY_IMPORTED`; distinto ⇒ `ALREADY_IMPORTED_WITH_DIFFERENT_DATA`, sin modificar el original);
sede existente y en alcance; cliente existente; productos existentes en el catálogo.
Las filas inválidas se rechazan individualmente; las válidas se incorporan.

## 4. Evidencia temporal y modelo predictivo

Las reservas incorporadas entran al flujo predictivo **sin fabricar evidencia**:

| Componente          | Origen para una reserva incorporada                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Horario, sede, FWA  | archivo (persistido)                                                                                                     |
| Servicios previstos | archivo; acreditados como foto de reserva solo si `cantidad_reprogramaciones = 0` (regla FLOWww: todo cambio deja copia) |
| Catálogo            | `x_config_products_det` + `product_catalog_resolution` vigentes (como la réplica)                                        |
| Edad / sexo         | `raw_flow.clients` (solo si `ClientStamp` es anterior a la reserva)                                                      |
| Historial as-of     | `analytics.ml_history_cumulative_v1` con `known_at < DiaryGCreated`                                                      |

Regla nueva y genérica `HISTORY_COVERAGE_INCOMPLETE`: si la reserva se creó **después** del último
corte del historial de la fuente (`max(updated_at)` de `ml_history_cumulative_v1`; en modo sintético,
el corte del dataset), el historial omitiría eventos previos a la predicción, por lo que la reserva
es `NOT_SCORABLE` (no se completan antecedentes con ceros). Solo la declaran las fuentes que pueden
ser posteriores al historial; las reservas de la réplica no cambian de comportamiento.

Con reprogramaciones (`> 0`) el archivo no trae la versión original ⇒
`RESCHEDULED_WITHOUT_ORIGINAL_SNAPSHOT` + `SCHEDULED_SERVICES_NOT_POINT_IN_TIME`.

El snapshot registra la procedencia real (`evidence.sources` = tablas usadas,
`sourceIngestionBatchId` = lote de importación).

## 5. Clientes prioritarios (`retention_priority_v1`)

Una fila por **reserva** que cumple simultáneamente:

1. `SCHEDULED`;
2. cita futura dentro de la **ventana móvil de 72 h** `(now, now + 72 h]` (Clock inyectado;
   centralizada en `RetentionWindow.ts`);
3. existe un score persistido del **modelo elegido** (`modelKey`) y es el **último** de ese modelo;
4. su banda experimental es `HIGH`;
5. la banda pertenece a la **política research vigente** del modelo (la del score v2 más reciente).

No se definen umbrales en Node, no se combinan RF y XGB, no se elige el modelo de mayor probabilidad,
no se reinterpretan scores de políticas anteriores y `riskLevel` permanece `null`
(`operationalUseAllowed=false`). Sin política vigente ⇒ lista vacía con
`experimentalClassificationUnavailable=true`. Los GET no escriben ni llaman a Python.

Filtros: `modelKey`, `clinicId`, `retentionStatus` (`PENDING`|`CAMPAIGN_SENT`), `sort`
(`appointmentAt`|`probabilityNoShow`), `direction`, `limit` (1–100), `cursor` (keyset firmado con
filtros, orden y política).

## 6. Exportación

Misma consulta, filtros y orden que el listado; recorre todas las páginas por keyset en lotes de 500
y emite en streaming. CSV UTF-8 con BOM, CRLF, todas las celdas entrecomilladas, separador `comma`
(defecto) o `semicolon`; cualquier valor que empiece con `=`, `+`, `-`, `@`, tab o CR se neutraliza
con `'`. IDs exactos como texto. Nombre:
`clientes-prioritarios-retencion_<modelKey>_<AAAAMMDD-HHmm Lima>.csv`. Sin datos personales.

> Excel convierte números largos al abrir un CSV con doble clic. Para conservar IDs de 16–18 dígitos
> en pantalla, abrir con _Datos → Desde texto/CSV_ y definir las columnas de ID como Texto. El archivo
> en sí contiene los dígitos exactos.

## 7. Registro de acción de retención

`POST /reservations/{id}/retention-contacts` con `{ clientId, modelKey, predictionRunId }`. Verifica:
reserva existente y accesible (404), titularidad (`RESERVATION_CLIENT_MISMATCH`), predicción de esa
reserva (`PREDICTION_RESERVATION_MISMATCH`), `retention_priority_v1` incluyendo que la predicción sea
la última del modelo (`RETENTION_NOT_ELIGIBLE` + `details.reasons`) y unicidad.

**Decisión funcional — granularidad:** la unidad de gestión es la **reserva/cita**. Un cliente no
recibe dos registros para la misma cita, pero contactarlo por una cita no marca sus otras reservas
futuras. `PENDING` se deriva de la ausencia de registro (no se insertan filas artificiales). El estado
es independiente del estado de la reserva, de la asistencia, de la habilitación preventiva, de la
recuperación de espacios y de la predicción.

Idempotencia: `UNIQUE (reservation_id)` + `INSERT … ON CONFLICT DO NOTHING`. Reintento idéntico ⇒
`200` con el registro original (`replayed=true`, fecha intacta); otra predicción ⇒ `409
RETENTION_CONTACT_ALREADY_RECORDED`. La fecha es del servidor. Autoría: `actorKind=INTERNAL_SERVICE`,
`actorUserId=null` (la credencial es de servicio a servicio). No se envía ninguna comunicación
(`communicationSent=false`).

## 8. Errores

| HTTP | Código                                                                                                                                                                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400  | `REQUEST_VALIDATION_ERROR` (query/cuerpo; cuerpo JSON sin coerción)                                                                                                                                                                                                                                                                              |
| 401  | `UNAUTHORIZED` (antes de leer el cuerpo)                                                                                                                                                                                                                                                                                                         |
| 404  | `RESERVATION_NOT_FOUND`                                                                                                                                                                                                                                                                                                                          |
| 409  | `RETENTION_NOT_ELIGIBLE`, `PREDICTION_RESERVATION_MISMATCH`, `RESERVATION_CLIENT_MISMATCH`, `RETENTION_CONTACT_ALREADY_RECORDED`                                                                                                                                                                                                                 |
| 413  | `PAYLOAD_TOO_LARGE` (archivo, campos o archivos extra; cuerpo JSON > 1024 B)                                                                                                                                                                                                                                                                     |
| 415  | `UNSUPPORTED_MEDIA_TYPE` (importación sin multipart)                                                                                                                                                                                                                                                                                             |
| 422  | archivo: `IMPORT_FILE_REQUIRED`, `UNSUPPORTED_FILE_FORMAT`, `FILE_CONTENT_MISMATCH`, `EMPTY_FILE`, `INVALID_FILE_ENCODING`, `INVALID_FILE_STRUCTURE`, `SPREADSHEET_*_NOT_ALLOWED`, `MISSING_REQUIRED_COLUMNS`, `DUPLICATE_COLUMNS`, `NO_DATA_ROWS`, `TOO_MANY_ROWS`; consulta: `UNKNOWN_CLINIC`, `INVALID_CURSOR`, `RANKING_CANDIDATES_EXCEEDED` |
| 503  | `PERSISTENCE_UNAVAILABLE`, `SOURCE_DATA_UNAVAILABLE`                                                                                                                                                                                                                                                                                             |

Errores de fila (dentro de un `201`): ver `ROW_REJECTION_MESSAGES` en
`src/modules/ReservationImport/Shared/contract/ReservationImportContract.ts` y el
[documento de integración](frontend-integration.md).

## 9. Migración `003_app_reservation_import_and_retention.sql`

Solo `up`, aditiva, validada por `AdditiveMigrationGuard` y aplicada por `PredictiveAppMigrationRunner`
con el rol migrador. Crea, en `ml.app_*`:

- `app_reservation_import_batches` (UNIQUE `batch_uid`; conteos con `CHECK total = aceptadas + rechazadas`).
- `app_imported_reservations` (UNIQUE `reservation_id`; FK diferida al lote; `CHECK` creación < cita,
  fin ≥ inicio, cita posterior al corte de procesamiento).
- `app_reservation_import_rejections` (fila, código, campo; **sin valores**).
- `app_retention_contacts` (UNIQUE `reservation_id`; FK compuestas a la predicción de esa reserva;
  `CHECK contacted_at < appointment_at`).
- Índices propios y triggers de inmutabilidad (`UPDATE`/`DELETE`/`TRUNCATE` ⇒ error).

`PREDICTIVE_APP_SCHEMA_VERSION` pasa a `'003'`: el arranque verifica la versión (fail-closed), por lo
que **la base operativa debe migrarse antes de desplegar esta versión**. Esa ejecución requiere
autorización explícita del propietario:

```bash
npm run store:migrate -- --dry-run      # plan, sin escribir
PREDICTIVE_STORE_MIGRATION_AUTHORIZED=true npm run store:migrate
```

Si la base usa roles restringidos, los privilegios por defecto del rol migrador conceden
`SELECT/INSERT` al runtime sobre las tablas nuevas.

## 10. Pruebas

```bash
npm run test:db:up      # PostgreSQL de PRUEBA aislado (docker-compose.test.yml, :55432, tmpfs)
npm run test:sprint3    # 18 casos: unitarios/HTTP + integración PostgreSQL de las nuevas capacidades
```

Sin el contenedor de prueba, las suites de integración se reportan como SKIP (nunca como PASS) y las
unitarias se ejecutan igual. Nunca se usa la base operativa ni el servicio real de ML.

| Archivo                                                                         | Casos                                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `tests/unit/modules/ReservationImport/ReservationImport.test.ts`                | CSV+XLSX válidos, errores de archivo (incl. HTTP), parcial, idempotencia, flujo predictivo |
| `tests/unit/modules/CustomerRetention/RetentionEligibility.test.ts`             | inclusión, exclusiones parametrizadas, filtros/modelo/paginación                           |
| `tests/unit/modules/CustomerRetention/RetentionExport.test.ts`                  | exportación completa por lotes, serialización segura (HTTP)                                |
| `tests/unit/modules/CustomerRetention/RetentionContact.test.ts`                 | registro, rechazos, concurrencia, estado en el listado                                     |
| `tests/integration/modules/ReservationImport/PostgresReservationImport.test.ts` | migración 003, concurrencia, inmutabilidad, keyset combinado                               |
| `tests/integration/modules/CustomerRetention/PostgresRetentionContacts.test.ts` | 10 registros concurrentes, FK, persistencia tras reinicio                                  |

## 11. Limitaciones conocidas

- Una reserva incorporada es inmutable: cambios posteriores (p. ej., cancelación) no se reflejan por
  reimportación (`ALREADY_IMPORTED_WITH_DIFFERENT_DATA`); prevalecen cuando la réplica la incorpora.
- Las reservas creadas después del último corte del historial de la réplica quedan `NOT_SCORABLE`
  (`HISTORY_COVERAGE_INCOMPLETE`) hasta que la réplica se actualice.
- Clientes, sedes y productos deben existir en la fuente del modo activo.
- Autenticación completa y roles siguen fuera de alcance (credencial interna de servicio).
