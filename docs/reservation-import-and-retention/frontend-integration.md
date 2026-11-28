# Integración frontend — importación de reservas y gestión de retención

Contratos para implementar las pantallas. El backend se consume **solo desde el servidor** del
frontend (la credencial `x-api-key` nunca va al navegador). Toda respuesta trae `requestId` y la
cabecera `x-request-id`. Instantes en ISO 8601 UTC; mostrarlos en America/Lima. Identificadores
siempre como **string** (no convertir a `number`). Datos de ejemplo sintéticos.

OpenAPI de estas rutas: [`openapi.json`](openapi.json) (Scalar completo en `/docs` en desarrollo).

Errores con el envoltorio común:

```json
{
  "error": {
    "code": "UNKNOWN_CLINIC",
    "message": "La sede no existe",
    "errors": [
      {
        "field": "clinicId",
        "code": "UNKNOWN_CLINIC",
        "message": "La sede no existe",
        "source": "querystring"
      }
    ]
  },
  "requestId": "…"
}
```

## 1. Importar reservas

`POST /api/v1/reservation-imports` — `multipart/form-data` con **un** campo `file` (`.csv` o `.xlsx`).

```bash
curl -X POST "$API/api/v1/reservation-imports" -H "x-api-key: $KEY" \
  -F "file=@reservation_import_v1_template.csv"
```

**201** (lote registrado, aunque se rechacen filas):

```json
{
  "data": {
    "batchId": "6f0d8a52-6b0e-4b8f-9a63-2d7b8f2a1c11",
    "contractVersion": "reservation_import_v1",
    "fileFormat": "CSV",
    "fileSha256": "3b1f…",
    "fileSizeBytes": 477,
    "status": "COMPLETED_WITH_REJECTIONS",
    "statusLabel": "Procesado con filas rechazadas",
    "processedAt": "2026-11-23T15:00:00.000Z",
    "totalRows": 3,
    "acceptedRows": 2,
    "rejectedRows": 1,
    "acceptedReservations": [
      { "rowNumber": 2, "reservationId": "900000000951001" },
      { "rowNumber": 3, "reservationId": "900000000951002" }
    ],
    "rejectedRowDetails": [
      {
        "rowNumber": 4,
        "reservationId": "900000000951003",
        "errors": [
          { "code": "UNKNOWN_CLINIC", "field": "DiaryGClinicID", "message": "La sede no existe" }
        ]
      }
    ],
    "rejectionSummary": [{ "code": "UNKNOWN_CLINIC", "message": "La sede no existe", "rows": 1 }],
    "ignoredColumns": [],
    "predictionsGenerated": false,
    "notice": "La importación no genera predicciones. …",
    "actorKind": "INTERNAL_SERVICE",
    "actorUserId": null
  },
  "requestId": "…"
}
```

`status`: `COMPLETED` (todo aceptado) · `COMPLETED_WITH_REJECTIONS` · `NO_ROWS_ACCEPTED`.
`rowNumber` cuenta la cabecera como fila 1. El valor recibido nunca se devuelve.

**Errores del archivo** (no se registra lote): `415 UNSUPPORTED_MEDIA_TYPE`, `413 PAYLOAD_TOO_LARGE`,
`422` con `error.code` ∈ `IMPORT_FILE_REQUIRED`, `UNSUPPORTED_FILE_FORMAT`, `FILE_CONTENT_MISMATCH`,
`EMPTY_FILE`, `INVALID_FILE_ENCODING`, `INVALID_FILE_STRUCTURE`, `SPREADSHEET_MACROS_NOT_ALLOWED`,
`SPREADSHEET_FORMULAS_NOT_ALLOWED`, `SPREADSHEET_EXTERNAL_CONTENT_NOT_ALLOWED`,
`MISSING_REQUIRED_COLUMNS` (`error.details.columns`), `DUPLICATE_COLUMNS`, `NO_DATA_ROWS`,
`TOO_MANY_ROWS` (`error.details.maxRows`).

**Códigos por fila** (`rejectedRowDetails[].errors[].code`): `REQUIRED_VALUE_MISSING`,
`INVALID_IDENTIFIER`, `INVALID_CLINIC_ID`, `INVALID_DATE`, `INVALID_TIME`, `INVALID_DATETIME`,
`INVALID_FLAG`, `INVALID_RESCHEDULE_COUNT`, `INVALID_SERVICE_LIST`, `INVALID_COLUMN_COUNT`,
`END_BEFORE_START`, `BOOKING_NOT_BEFORE_APPOINTMENT`, `BOOKING_CREATED_IN_FUTURE`,
`APPOINTMENT_NOT_FUTURE`, `NOT_A_RESERVATION`, `DUPLICATE_ROW_IN_FILE`,
`CONFLICTING_DUPLICATE_IN_FILE`, `RESERVATION_EXISTS_IN_SOURCE`, `ALREADY_IMPORTED`,
`ALREADY_IMPORTED_WITH_DIFFERENT_DATA`, `UNKNOWN_CLINIC`, `CLINIC_OUT_OF_SCOPE`, `CLIENT_NOT_FOUND`,
`PRODUCT_NOT_FOUND`. Usar `message` como texto visible.

UI sugerida: selector de archivo (`.csv,.xlsx`), descarga de las plantillas sintéticas, resumen
(total/aceptadas/rechazadas), tabla de filas rechazadas y enlace a `GET /reservations/{id}` para las
aceptadas. Las reservas incorporadas aparecen en el listado/detalle con `origin: "IMPORT"` e
`importBatchId`.

## 2. Clientes prioritarios

`GET /api/v1/retention/priority-clients`

| Parámetro         | Valores                                          | Defecto                 |
| ----------------- | ------------------------------------------------ | ----------------------- |
| `modelKey`        | `random_forest_full_v1` \| `xgboost_full_v1`     | `random_forest_full_v1` |
| `clinicId`        | `"1"`…`"999999999"`                              | —                       |
| `retentionStatus` | `PENDING` \| `CAMPAIGN_SENT`                     | —                       |
| `sort`            | `appointmentAt` \| `probabilityNoShow`           | `appointmentAt`         |
| `direction`       | `asc` \| `desc`                                  | `asc`                   |
| `limit`           | 1–100                                            | 25                      |
| `cursor`          | `pagination.nextCursor` (mismos filtros y orden) | —                       |

**200**:

```json
{
  "data": [
    {
      "clientId": "900000000002001",
      "reservationId": "900000000101001",
      "clinicId": 1,
      "appointmentAt": "2026-11-11T15:00:00.000Z",
      "reservationStatus": "SCHEDULED",
      "origin": "SOURCE",
      "importBatchId": null,
      "prediction": {
        "modelKey": "xgboost_full_v1",
        "modelVersion": "…",
        "modelHash": "…",
        "probabilityNoShow": 0.82,
        "percentageNoShow": 82,
        "scoredAt": "2026-11-09T12:00:00.000Z",
        "predictionRunId": "00000000-0000-4000-8000-000000000001",
        "riskLevel": null,
        "experimentalRisk": {
          "level": "HIGH",
          "label": "Alto (exploratorio)",
          "status": "RESEARCH_PROVISIONAL",
          "policyId": "xgboost_full_v1_tertiles_202604_202605",
          "policyVersion": "research_risk_v1_1",
          "policyHash": "208c706d…"
        }
      },
      "retention": {
        "status": "PENDING",
        "statusLabel": "Gestión pendiente",
        "contactId": null,
        "contactedAt": null,
        "contactModelKey": null,
        "contactPredictionRunId": null
      }
    }
  ],
  "pagination": { "limit": 25, "nextCursor": null },
  "window": {
    "ruleVersion": "retention_priority_v1",
    "hours": 72,
    "startExclusive": "2026-11-10T15:00:00.000Z",
    "endInclusive": "2026-11-13T15:00:00.000Z",
    "timeZone": "America/Lima"
  },
  "sort": {
    "field": "appointmentAt",
    "direction": "asc",
    "modelKey": "xgboost_full_v1",
    "semantics": "CHRONOLOGICAL"
  },
  "filters": { "clinicId": null, "retentionStatus": null },
  "experimentalClassificationUnavailable": false,
  "experimentalRiskPolicy": {
    "modelKey": "xgboost_full_v1",
    "policyId": "…",
    "policyVersion": "research_risk_v1_1",
    "policyHash": "…",
    "status": "RESEARCH_PROVISIONAL",
    "classificationBasis": "RESEARCH_PROVISIONAL",
    "operationalUseAllowed": false,
    "notice": "Banda EXPERIMENTAL …"
  },
  "riskPolicyStatus": "pending_validation",
  "predictiveStoreAvailable": true,
  "requestId": "…"
}
```

Reglas de presentación:

- Una fila por **cita**; un cliente con dos citas próximas aparece dos veces (distinguir por
  `reservationId` y `appointmentAt`).
- Mostrar la banda como «Alto (exploratorio)» con la `notice`; **no** mostrar `riskLevel` como riesgo
  (es `null`). El orden por probabilidad es exploratorio.
- `experimentalClassificationUnavailable: true` ⇒ mensaje «sin política experimental vigente para
  este modelo» (la lista llega vacía; no es un error).
- El selector de modelo cambia la lista (RF y XGB son independientes).

## 3. Exportar

`GET /api/v1/retention/priority-clients/export` con los **mismos** filtros y orden (sin
`limit`/`cursor`) más `delimiter=comma|semicolon` (defecto `comma`). Respuesta `200 text/csv;
charset=utf-8` con `Content-Disposition: attachment; filename="clientes-prioritarios-retencion_<modelo>_<AAAAMMDD-HHmm>.csv"`.
Contiene **todas** las filas que cumplen los filtros. Desde el servidor del frontend, reenviar el
flujo al navegador conservando `Content-Type` y `Content-Disposition`. Los errores de validación
llegan como JSON (no como CSV).

Columnas: ID cliente · ID reserva · Fecha y hora de cita (America/Lima) · Fecha y hora de cita (UTC)
· ID sede · Modelo predictivo · Versión del modelo · Probabilidad estimada de inasistencia ·
Porcentaje estimado de inasistencia · Banda relativa de riesgo (experimental) · Estado de gestión de
retención · Fecha y hora de contacto (America/Lima) · ID de ejecución de predicción · Fecha de
estimación (UTC) · Política experimental · Origen de la reserva.

## 4. Registrar una acción de retención

`POST /api/v1/reservations/{reservationId}/retention-contacts` — JSON estricto (≤ 1024 bytes, sin
coerción: los IDs son strings).

```json
{
  "clientId": "900000000002001",
  "modelKey": "xgboost_full_v1",
  "predictionRunId": "00000000-0000-4000-8000-000000000001"
}
```

Tomar los tres valores de la fila del listado (`clientId`, `prediction.modelKey`,
`prediction.predictionRunId`). **201** crea; **200** reintento idéntico (`replayed: true`, misma
`contactedAt`).

```json
{
  "data": {
    "contactId": "1",
    "reservationId": "900000000101001",
    "clientId": "900000000002001",
    "clinicId": 1,
    "appointmentAt": "2026-11-11T15:00:00.000Z",
    "retentionStatus": "CAMPAIGN_SENT",
    "retentionStatusLabel": "Campaña de retención enviada",
    "contactedAt": "2026-11-10T15:00:00.000Z",
    "modelKey": "xgboost_full_v1",
    "modelVersion": "…",
    "predictionRunId": "00000000-0000-4000-8000-000000000001",
    "riskBandAtContact": "HIGH",
    "probabilityNoShowAtContact": 0.82,
    "researchPolicyHash": "…",
    "researchPolicyVersion": "research_risk_v1_1",
    "scoredAt": "2026-11-09T12:00:00.000Z",
    "eligibilityRuleVersion": "retention_priority_v1",
    "communicationSent": false,
    "actorKind": "INTERNAL_SERVICE",
    "actorUserId": null,
    "replayed": false
  },
  "requestId": "…"
}
```

Errores: `404 RESERVATION_NOT_FOUND`; `409` `RETENTION_NOT_ELIGIBLE` (`error.details.reasons[]` con
`RESERVATION_NOT_SCHEDULED`, `APPOINTMENT_NOT_FUTURE`, `APPOINTMENT_OUTSIDE_RETENTION_WINDOW`,
`NOT_SCORED`, `PREDICTION_NOT_LATEST`, `EXPERIMENTAL_BAND_UNAVAILABLE`, `PREDICTION_NOT_HIGH`,
`RESEARCH_POLICY_NOT_CURRENT`), `PREDICTION_RESERVATION_MISMATCH`, `RESERVATION_CLIENT_MISMATCH`,
`RETENTION_CONTACT_ALREADY_RECORDED` (`error.details` con el registro existente); `400`; `413`.

UI sugerida: botón «Registrar campaña de retención» con confirmación; aclarar que el sistema **no
envía** mensajes. Ante `PREDICTION_NOT_LATEST`, recargar la fila. Tras el registro, refrescar el
listado: la fila pasa a `CAMPAIGN_SENT` con `contactedAt`. El estado persiste entre sesiones.
