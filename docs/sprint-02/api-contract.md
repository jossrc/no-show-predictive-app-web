# Sprint 02 · Contrato de API (HU-06, HU-07, HU-08)

Inventario **exacto** de lo implementado. Las respuestas de ejemplo son salidas reales de la API
sobre datos **100 % sintéticos** (reserva `900000000001001`, UUID de run normalizado a
`00000000-0000-4000-8000-000000000001`). OpenAPI exportado: [`openapi.json`](openapi.json)
(regenerable en `NODE_ENV=development` desde `GET /docs/openapi.json`; Scalar en `/docs`, tag
**Operational optimization**).

## 0. Convenciones comunes

| Aspecto           | Regla                                                                                                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base              | `/api/v1` (prefijo existente).                                                                                                                                                                                                                                                                                     |
| Seguridad         | Cabecera `x-api-key` (credencial interna provisional, servicio a servicio). Sin ella ⇒ `401` **antes** de validar o buscar (no revela existencia). No es login: `actorKind="INTERNAL_SERVICE"`, `actorUserId=null`.                                                                                                |
| IDs               | `reservationId`, `authorizationId`, `attendanceOutcomeId`, `recoveryOutcomeId` son **strings decimales** (hasta 18 dígitos). `predictionRunId` es UUID (string). Nunca convertir a número.                                                                                                                         |
| Fechas            | Respuestas en ISO-8601 UTC. Filtros `from`/`to` son fechas **del calendario America/Lima** (inclusivas; máx. 92 días), aplicadas sobre la fecha de la **cita**.                                                                                                                                                    |
| Envoltorio        | Éxito `{ "data": …, "requestId": "…" }`; listados además `pagination` y `period`. Error `{ "error": { "code", "message", "errors?", "details?" }, "requestId" }`. `requestId` = cabecera `x-request-id` (se acepta una entrante válida).                                                                           |
| Cuerpos POST      | JSON **estricto**: sin coerción de tipos (`"true"`, `1`, `null` no son booleanos; `"NO_SHOW"` no se convierte en arreglo), `additionalProperties:false`, máx. 1024 bytes (`413`).                                                                                                                                  |
| Códigos           | `200` lectura / reintento idéntico · `201` creado · `400` `REQUEST_VALIDATION_ERROR` · `401` · `404` `RESERVATION_NOT_FOUND` · `409` conflicto de negocio · `413` · `422` consulta semántica (`INVALID_PERIOD`, `UNKNOWN_CLINIC`, `INVALID_CURSOR`) · `503` `PERSISTENCE_UNAVAILABLE` / `SOURCE_DATA_UNAVAILABLE`. |
| Efectos           | Los GET nunca escriben ni llaman a Python. Los POST solo insertan en `ml.app_*`; nunca modifican la reserva en FLOWww, no crean citas ni recalculan predicciones.                                                                                                                                                  |
| `null` vs `false` | `null` = sin registro / desconocido; `false` = valor explícito registrado.                                                                                                                                                                                                                                         |

## 1. Cambios ADITIVOS en endpoints de Sprint 01

`GET /api/v1/reservations` (cada fila de `data[]`) y `GET /api/v1/reservations/{reservationId}`
(`data`) incorporan tres objetos nuevos. Todas las claves previas conservan nombre, tipo y valor;
`reservationStatus` sigue siendo el estado de la reserva **fuente** (`SCHEDULED|CANCELLED|PAST`).

```json
"overbooking": {
  "enabled": true,
  "status": "ENABLED",
  "statusLabel": "Habilitado para sobreasignación",
  "authorizationId": "1",
  "enabledAt": "2026-10-25T15:00:00.000Z",
  "modelKey": "random_forest_full_v1",
  "predictionRunId": "00000000-0000-4000-8000-000000000001"
},
"attendanceOutcome": { "recorded": true, "attendanceStatus": "NO_SHOW", "recordedAt": "2026-11-12T21:00:00.000Z" },
"spaceRecoveryOutcome": { "recorded": true, "spaceRecovered": false, "recordedAt": "2026-11-12T21:00:00.000Z" }
```

| Campo                                              | Tipo                                | Significado                                                                                              |
| -------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `overbooking`                                      | objeto \| `null`                    | `null` solo si el almacén de la app no está disponible (`predictiveStoreAvailable=false` en el listado). |
| `overbooking.enabled` / `status`                   | boolean / `ENABLED\|NOT_ENABLED`    | Marca HU-06. Sin marca: `false` / `NOT_ENABLED`, demás campos `null`, `statusLabel="No habilitado"`.     |
| `attendanceOutcome.recorded` / `attendanceStatus`  | boolean / `ATTENDED\|NO_SHOW\|null` | HU-07. `recorded=false` ⇒ `attendanceStatus=null`.                                                       |
| `spaceRecoveryOutcome.recorded` / `spaceRecovered` | boolean / boolean\|`null`           | HU-08. `null` = sin registro; `false` = gestionado sin recuperar.                                        |

Se leen por lote (una consulta por página, sin N+1). Pruebas de regresión de Sprint 01: todas en verde.

## 2. HU-06 · Habilitación de horarios para sobreasignación

### 2.1 `GET /api/v1/reservations/{reservationId}/overbooking-authorization`

Estado de la marca + elegibilidad calculada por el backend (regla `overbooking_eligibility_v1`).
Lectura pura. Path: `reservationId` (`^[1-9][0-9]{0,17}$`).

```bash
curl -s -H "x-api-key: $INTERNAL_API_KEY" \
  http://127.0.0.1:3000/api/v1/reservations/900000000001001/overbooking-authorization
```

`200` (reserva con predicción HIGH aún no habilitada):

```json
{
  "data": {
    "reservationId": "900000000001001",
    "enabled": false,
    "status": "NOT_ENABLED",
    "statusLabel": "No habilitado",
    "authorization": null,
    "eligibility": {
      "ruleVersion": "overbooking_eligibility_v1",
      "eligible": true,
      "reasons": [],
      "candidates": [
        {
          "modelKey": "random_forest_full_v1",
          "predictionRunId": "00000000-0000-4000-8000-000000000001",
          "probabilityNoShow": 0.6976400433344135,
          "scoredAt": "2026-10-25T15:00:00.000Z",
          "experimentalRiskLevel": "HIGH",
          "researchPolicyHash": "1d58ce962e899b758275f7191244225e8c970cf2db9661ffcb21be9b63a4ce74",
          "eligible": true,
          "reasons": []
        },
        {
          "modelKey": "xgboost_full_v1",
          "predictionRunId": "00000000-0000-4000-8000-000000000001",
          "probabilityNoShow": 0.9159286618232727,
          "scoredAt": "2026-10-25T15:00:00.000Z",
          "experimentalRiskLevel": "HIGH",
          "researchPolicyHash": "208c706d839b7c8b71134cd225da4bc1bb935c5d4bd06cbb898a8d8f84ee7032",
          "eligible": true,
          "reasons": []
        }
      ]
    }
  },
  "requestId": "req-synthetic-eligibility_high"
}
```

Regla `overbooking_eligibility_v1` (todo en el servidor, con el `Clock` inyectado):

1. Reserva fuente `SCHEDULED` (si no: `RESERVATION_NOT_SCHEDULED`).
2. Cita futura: `appointmentAt > ahora` (si no: `APPOINTMENT_NOT_FUTURE`).
3. Existe al menos un score persistido (si no: `NOT_SCORED`).
4. Por **cada modelo por separado** (sin ensemble ni ganador), sobre su **último** score:
   banda experimental research v2 presente (`EXPERIMENTAL_BAND_UNAVAILABLE`), `level = HIGH`
   (`PREDICTION_NOT_HIGH`) y bajo la política research vigente (`RESEARCH_POLICY_NOT_CURRENT`).
5. Ya habilitada ⇒ `ALREADY_ENABLED` (eligible=false).

`eligibility.reasons` contiene motivos de reserva; `candidates[].reasons`, motivos por modelo. El
`riskLevel` operativo (null, política pendiente) **no** se usa.

Errores: `400` id inválido · `401` · `404 RESERVATION_NOT_FOUND` · `503`.

### 2.2 `POST /api/v1/reservations/{reservationId}/overbooking-authorizations`

Cuerpo (estricto; el cliente **no** envía riesgo, sede, fechas ni autor):

| Campo             | Tipo                                         | Regla                                                                  |
| ----------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| `modelKey`        | `random_forest_full_v1` \| `xgboost_full_v1` | Modelo cuya predicción HIGH justifica la marca.                        |
| `predictionRunId` | string UUID                                  | `predictionRunId` del candidato elegible (último score de ese modelo). |

```bash
curl -s -X POST -H "x-api-key: $INTERNAL_API_KEY" -H 'content-type: application/json' \
  -d '{"modelKey":"random_forest_full_v1","predictionRunId":"00000000-0000-4000-8000-000000000001"}' \
  http://127.0.0.1:3000/api/v1/reservations/900000000001001/overbooking-authorizations
```

`201` (creada) — `200` idéntico con `"replayed": true` en reintento con el mismo `modelKey` y `predictionRunId`:

```json
{
  "data": {
    "authorizationId": "1",
    "reservationId": "900000000001001",
    "clinicId": 1,
    "appointmentAt": "2026-11-12T20:00:00.000Z",
    "status": "ENABLED",
    "statusLabel": "Habilitado para sobreasignación",
    "enabledAt": "2026-10-25T15:00:00.000Z",
    "modelKey": "random_forest_full_v1",
    "modelVersion": "random_forest_full_v1:4e3c86a17005",
    "predictionRunId": "00000000-0000-4000-8000-000000000001",
    "riskBandAtAuthorization": "HIGH",
    "probabilityNoShowAtAuthorization": 0.6976400433344135,
    "researchPolicyHash": "1d58ce962e899b758275f7191244225e8c970cf2db9661ffcb21be9b63a4ce74",
    "researchPolicyVersion": "research_risk_v1_1",
    "scoredAt": "2026-10-25T15:00:00.000Z",
    "eligibilityRuleVersion": "overbooking_eligibility_v1",
    "actorKind": "INTERNAL_SERVICE",
    "actorUserId": null,
    "enabled": true,
    "replayed": false
  },
  "requestId": "req-synthetic-enable_201"
}
```

Errores:

| HTTP | `error.code`                           | Cuándo                                                                                                                               | `details`                                    |
| ---- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| 400  | `REQUEST_VALIDATION_ERROR`             | Falta campo, `modelKey` inválido, UUID inválido, campos extra (p. ej. `riskLevel`, `clinicId`).                                      | `errors[]`                                   |
| 404  | `RESERVATION_NOT_FOUND`                | Reserva inexistente o fuera del alcance.                                                                                             | —                                            |
| 409  | `OVERBOOKING_NOT_ELIGIBLE`             | No cumple la regla; incluye `PREDICTION_NOT_LATEST` si el run no es el último del modelo (vista desactualizada: volver a consultar). | `reasons[{code,message}]`                    |
| 409  | `PREDICTION_RESERVATION_MISMATCH`      | El run/modelo no es una predicción persistida de esta reserva (o no existe).                                                         | —                                            |
| 409  | `OVERBOOKING_ALREADY_ENABLED_CONFLICT` | Ya existe marca con OTRA predicción (no se reemplaza).                                                                               | `authorizationId, modelKey, predictionRunId` |
| 413  | `PAYLOAD_TOO_LARGE`                    | Cuerpo > 1024 bytes.                                                                                                                 | —                                            |
| 503  | `PERSISTENCE_UNAVAILABLE`              | Almacén de la app no disponible.                                                                                                     | —                                            |

Ejemplo real `409`:

```json
{
  "error": {
    "code": "OVERBOOKING_ALREADY_ENABLED_CONFLICT",
    "message": "El horario ya fue habilitado con otra predicción; la marca no se reemplaza",
    "details": {
      "authorizationId": "1",
      "modelKey": "random_forest_full_v1",
      "predictionRunId": "00000000-0000-4000-8000-000000000001"
    }
  },
  "requestId": "req-synthetic-enable_409_conflict"
}
```

Concurrencia: N POST simultáneos ⇒ exactamente 1 registro (`201` una vez, `200` el resto). No hay
endpoint de revocación ni borrado en Sprint 02.

### 2.3 `GET /api/v1/overbooking-authorizations`

Query (común a los tres listados):

| Parámetro    | Tipo          | Obligatorio | Regla                                                                                            |
| ------------ | ------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `from`, `to` | `YYYY-MM-DD`  | sí          | Fechas de cita en America/Lima, inclusivas, `to ≥ from`, máx. 92 días (`422 INVALID_PERIOD`).    |
| `clinicId`   | string entero | no          | Debe existir (`422 UNKNOWN_CLINIC`). El alcance del consumidor se aplica siempre en el servidor. |
| `limit`      | entero 1–100  | no (25)     | Tamaño de página.                                                                                |
| `cursor`     | string opaco  | no          | `pagination.nextCursor` anterior; ligado al tipo de listado y filtros (`422 INVALID_CURSOR`).    |

Orden estable: `appointmentAt ASC, reservationId ASC` (keyset, sin duplicados ni saltos).

```json
{
  "data": [
    {
      "authorizationId": "1",
      "reservationId": "900000000001001",
      "clinicId": 1,
      "appointmentAt": "2026-11-12T20:00:00.000Z",
      "status": "ENABLED",
      "statusLabel": "Habilitado para sobreasignación",
      "enabledAt": "2026-10-25T15:00:00.000Z",
      "modelKey": "random_forest_full_v1",
      "modelVersion": "random_forest_full_v1:4e3c86a17005",
      "predictionRunId": "00000000-0000-4000-8000-000000000001",
      "riskBandAtAuthorization": "HIGH",
      "probabilityNoShowAtAuthorization": 0.6976400433344135,
      "researchPolicyHash": "1d58ce962e899b758275f7191244225e8c970cf2db9661ffcb21be9b63a4ce74",
      "researchPolicyVersion": "research_risk_v1_1",
      "scoredAt": "2026-10-25T15:00:00.000Z",
      "eligibilityRuleVersion": "overbooking_eligibility_v1",
      "actorKind": "INTERNAL_SERVICE",
      "actorUserId": null
    }
  ],
  "pagination": { "limit": 25, "nextCursor": null },
  "period": {
    "from": "2026-11-01",
    "to": "2026-11-30",
    "timeZone": "America/Lima",
    "startInclusive": "2026-11-01T05:00:00.000Z",
    "endExclusive": "2026-12-01T05:00:00.000Z"
  },
  "requestId": "req-synthetic-list_authorizations"
}
```

Errores: `400`, `401`, `422`, `503`.

## 3. HU-07 · Registro del resultado real de la predicción

### 3.1 `GET /api/v1/reservations/{reservationId}/attendance-outcome`

Lectura pura. Sin registro:

```json
{
  "data": {
    "reservationId": "900000000001001",
    "recorded": false,
    "attendanceStatus": null,
    "outcome": null,
    "registration": {
      "ruleVersion": "appointment_finished_rule_v1",
      "registrable": true,
      "blocker": null,
      "availablePredictionRunIds": ["00000000-0000-4000-8000-000000000001"]
    }
  },
  "requestId": "req-synthetic-attendance_get_registrable"
}
```

`registration.blocker` ∈ `ALREADY_RECORDED`, `RESERVATION_CANCELLED`, `APPOINTMENT_NOT_STARTED`,
`APPOINTMENT_IN_PROGRESS`, `APPOINTMENT_END_UNKNOWN`, `PREDICTION_REQUIRED`, `null`.
`availablePredictionRunIds`: runs que contienen el último score de cada modelo. Con registro:
`recorded=true`, `attendanceStatus` y `outcome` (mismo cuerpo que el POST, sin `replayed`).

Regla `appointment_finished_rule_v1` (cita **finalizada**, solo con evidencia de la fuente):
reserva no `CANCELLED`; inicio vencido según el `Clock`; y (`reservationStatus = PAST` según el ETL)
**o** (fin programado en FLOWww — `DiaryGDate + DiaryGEnd`, hora de Lima — ya vencido). Sin fin
acreditado ⇒ no se asume que terminó (`APPOINTMENT_END_UNKNOWN`).

### 3.2 `POST /api/v1/reservations/{reservationId}/attendance-outcomes`

| Campo              | Tipo                    | Regla                                                                     |
| ------------------ | ----------------------- | ------------------------------------------------------------------------- |
| `attendanceStatus` | `ATTENDED` \| `NO_SHOW` | Observación explícita de recepción. Una cancelación NO es `NO_SHOW`.      |
| `predictionRunId`  | string UUID             | Run previo de **esta** reserva (con score anterior al inicio de la cita). |

`201` (`200` con `replayed:true` si se repite el mismo `attendanceStatus` y `predictionRunId`):

```json
{
  "data": {
    "attendanceOutcomeId": "2",
    "reservationId": "900000000001001",
    "clinicId": 1,
    "appointmentAt": "2026-11-12T20:00:00.000Z",
    "appointmentEndAt": "2026-11-12T20:40:00.000Z",
    "attendanceStatus": "NO_SHOW",
    "observedNoShow": true,
    "recordedAt": "2026-11-12T21:00:00.000Z",
    "predictionRunId": "00000000-0000-4000-8000-000000000001",
    "finishedRuleVersion": "appointment_finished_rule_v1",
    "comparisons": [
      {
        "modelKey": "random_forest_full_v1",
        "modelVersion": "random_forest_full_v1:4e3c86a17005",
        "probabilityNoShow": 0.6976400433344135,
        "scoredAt": "2026-10-25T15:00:00.000Z",
        "experimentalRiskLevel": "HIGH",
        "comparisonRuleVersion": "binary_outcome_threshold_v1",
        "threshold": 0.5,
        "predictedNoShow": true,
        "observedNoShow": true,
        "matchesPrediction": true
      },
      {
        "modelKey": "xgboost_full_v1",
        "modelVersion": "xgboost_full_v1:376d3db9d4d3",
        "probabilityNoShow": 0.9159286618232727,
        "scoredAt": "2026-10-25T15:00:00.000Z",
        "experimentalRiskLevel": "HIGH",
        "comparisonRuleVersion": "binary_outcome_threshold_v1",
        "threshold": 0.5,
        "predictedNoShow": true,
        "observedNoShow": true,
        "matchesPrediction": true
      }
    ],
    "comparisonNotice": "Comparación descriptiva por algoritmo (binary_outcome_threshold_v1: probabilityNoShow >= 0.5 ⇒ inasistencia predicha). Umbral técnico provisional, no validado; no es evaluación científica final del modelo.",
    "actorKind": "INTERNAL_SERVICE",
    "actorUserId": null,
    "replayed": false
  },
  "requestId": "req-synthetic-attendance_201"
}
```

Comparación (`binary_outcome_threshold_v1`, **provisional**): por modelo del run,
`predictedNoShow = probabilityNoShow >= 0.5`; `matchesPrediction = predictedNoShow === observedNoShow`.
No es un umbral validado ni redefine las bandas Bajo/Medio/Alto; la regla y el umbral quedan
guardados con cada comparación. RF y XGB pueden coincidir de forma distinta. Las probabilidades
provienen de los scores persistidos, nunca del request.

Errores:

| HTTP      | `error.code`                                    | Cuándo                                                                                                    |
| --------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 400       | `REQUEST_VALIDATION_ERROR`                      | `attendanceStatus` fuera del enum, UUID inválido, campos faltantes/extra.                                 |
| 404       | `RESERVATION_NOT_FOUND`                         | Inexistente o fuera de alcance.                                                                           |
| 409       | `APPOINTMENT_NOT_FINISHED`                      | `details.reason`: `APPOINTMENT_NOT_STARTED`, `APPOINTMENT_IN_PROGRESS`, `APPOINTMENT_END_UNKNOWN`.        |
| 409       | `RESERVATION_CANCELLED`                         | La reserva está cancelada.                                                                                |
| 409       | `PREDICTION_REQUIRED`                           | La reserva no tiene ninguna predicción persistida.                                                        |
| 409       | `PREDICTION_RESERVATION_MISMATCH`               | El run no pertenece a esta reserva (o no existe).                                                         |
| 409       | `PREDICTION_AFTER_APPOINTMENT`                  | Algún score del run es posterior al inicio de la cita (evita fuga temporal).                              |
| 409       | `ATTENDANCE_ALREADY_RECORDED_CONFLICT`          | Ya registrada con otro valor/run (`details.attendanceStatus`, `details.predictionRunId`); no se modifica. |
| 413 / 503 | `PAYLOAD_TOO_LARGE` / `PERSISTENCE_UNAVAILABLE` | —                                                                                                         |

### 3.3 `GET /api/v1/attendance-outcomes`

Mismos parámetros y paginación que §2.3. `data[]` = cuerpos de outcome (con `comparisons`, sin
`replayed`). Insumo para la evaluación HU-12 (Sprint 02 no calcula métricas ni reportes).

## 4. HU-08 · Registro de espacios recuperados

### 4.1 `GET /api/v1/reservations/{reservationId}/space-recovery-outcome`

```json
{
  "data": {
    "reservationId": "900000000001001",
    "recorded": false,
    "spaceRecovered": null,
    "outcome": null,
    "preventiveAction": { "enabled": true, "authorizationId": "1" },
    "registrable": true,
    "blocker": null
  },
  "requestId": "req-synthetic-recovery_get_empty"
}
```

`blocker` ∈ `PREVENTIVE_ACTION_REQUIRED` (sin marca HU-06), `ALREADY_RECORDED`, `null`.

### 4.2 `POST /api/v1/reservations/{reservationId}/space-recovery-outcomes`

Cuerpo: `{ "spaceRecovered": true | false }` (booleano JSON obligatorio; `null`, `"true"`, `1` ⇒ `400`).
Requiere marca HU-06 previa; **no** requiere HU-07. Horario y sede se toman de la autorización.

`201` (`200` con `replayed:true` si se repite el mismo valor):

```json
{
  "data": {
    "recoveryOutcomeId": "3",
    "authorizationId": "1",
    "reservationId": "900000000001001",
    "clinicId": 1,
    "appointmentAt": "2026-11-12T20:00:00.000Z",
    "spaceRecovered": false,
    "recordedAt": "2026-11-12T21:00:00.000Z",
    "actorKind": "INTERNAL_SERVICE",
    "actorUserId": null,
    "replayed": false
  },
  "requestId": "req-synthetic-recovery_201"
}
```

Errores: `400` (ej. real: `{"error":{"code":"REQUEST_VALIDATION_ERROR","message":"La solicitud contiene datos inválidos","errors":[{"field":"spaceRecovered","code":"INVALID_TYPE","message":"El campo spaceRecovered tiene un tipo inválido","source":"body"}]},"requestId":"…"}`),
`404`, `409 PREVENTIVE_ACTION_REQUIRED` (sin HU-06; **cero escrituras**),
`409 SPACE_RECOVERY_ALREADY_RECORDED_CONFLICT` (`details.spaceRecovered` = valor existente), `413`, `503`.

### 4.3 `GET /api/v1/space-recovery-outcomes`

Mismos parámetros y paginación que §2.3. Insumo para la contabilización HU-13.

## 5. Inventario final

| Método | Ruta                                                              | HU    | Éxito                                        |
| ------ | ----------------------------------------------------------------- | ----- | -------------------------------------------- |
| POST   | `/api/v1/reservations/{reservationId}/overbooking-authorizations` | 06    | 201 / 200                                    |
| GET    | `/api/v1/reservations/{reservationId}/overbooking-authorization`  | 06    | 200                                          |
| GET    | `/api/v1/overbooking-authorizations`                              | 06    | 200                                          |
| POST   | `/api/v1/reservations/{reservationId}/attendance-outcomes`        | 07    | 201 / 200                                    |
| GET    | `/api/v1/reservations/{reservationId}/attendance-outcome`         | 07    | 200                                          |
| GET    | `/api/v1/attendance-outcomes`                                     | 07    | 200                                          |
| POST   | `/api/v1/reservations/{reservationId}/space-recovery-outcomes`    | 08    | 201 / 200                                    |
| GET    | `/api/v1/reservations/{reservationId}/space-recovery-outcome`     | 08    | 200                                          |
| GET    | `/api/v1/space-recovery-outcomes`                                 | 08    | 200                                          |
| GET    | `/api/v1/reservations`, `/api/v1/reservations/{reservationId}`    | 06–08 | 200 (campos aditivos §1)                     |
| GET    | `/api/v1/health/predictive-store`                                 | —     | 200 (`driver: postgresql`, `restrictedRole`) |

Prerrequisito de datos: HU-06 y HU-07 necesitan predicciones ya guardadas
(`POST /api/v1/reservations/{id}/predictions`, Sprint 01). Para HU-06 elegir `modelKey` y
`predictionRunId` de `eligibility.candidates[]` con `eligible=true`.
