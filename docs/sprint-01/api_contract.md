# Sprint 01 — Contrato HTTP (implementado)

Prefijo existente `/api`; rutas nuevas versionadas en `/api/v1`. Rutas existentes intactas:
`GET /api/health/postgres`, `GET /api/health/mysql`.

## Autenticación provisional

Todas las rutas de negocio exigen `x-api-key` (credencial interna ≥ 32 caracteres; el servidor
guarda solo su SHA-256 en `INTERNAL_API_KEY_SHA256` y compara en tiempo constante). Se evalúa en
`onRequest`: **401 uniforme** antes de validar parámetros (no revela existencia de reservas).
Sin `INTERNAL_API_KEY_SHA256` las rutas no se registran (404). En `production` el arranque se
rechaza (`AUTH_FULL_FLOW_PENDING_HU21_HU22`) salvo `PREDICTIVE_API_ENABLED=false`.
**No es login (HU-21) ni RBAC (HU-22).** La clave nunca debe llegar al navegador: el consumidor
es un servidor (p. ej. Next.js server-side). Sin CORS habilitado.

## Endpoints

| HU       | Método y ruta                                            | Parámetros                                                                                                                                                                                                                                                                             | Respuesta                                                                                                                                                                             | Errores                                                                                                                                                                                                                                  |
| -------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Soporte  | `GET /api/v1/health/ml`                                  | — (sin credencial, sin datos sensibles)                                                                                                                                                                                                                                                | `{service,status,message,servingStatus,operationalUseAllowed}`                                                                                                                        | 503 si Python no está listo                                                                                                                                                                                                              |
| Soporte  | `GET /api/v1/ml/models`                                  | —                                                                                                                                                                                                                                                                                      | identidad pública de RF/XGB (versión, hash corto, rol, estado)                                                                                                                        | 401, 429, 502, 503, 504                                                                                                                                                                                                                  |
| HU-01/03 | `GET /api/v1/reservations`                               | `from`,`to` (YYYY-MM-DD Lima, ≤92 días), `status` (`SCHEDULED`_/`CANCELLED`), `clinicId`, `sort` (`appointmentAt`_/`probabilityNoShow`/`riskLevel`), `direction` (`asc`_/`desc`), `modelKey` (`random_forest_full_v1`_/`xgboost_full_v1`), `riskLevel`, `limit` (1–100, 25*), `cursor` | `data[]` (reserva + `risk`), `pagination{limit,nextCursor}`, `period`, `sort{semantics}`, `riskPolicyStatus`, `classificationUnavailable`, `sourceStatus`, `predictiveStoreAvailable` | 400, 401, 409 `RISK_POLICY_UNAVAILABLE`, 422 `INVALID_PERIOD`/`UNKNOWN_CLINIC`/`INVALID_CURSOR`, 503 `SOURCE_DATA_UNAVAILABLE`                                                                                                           |
| HU-01/02 | `GET /api/v1/reservations/:reservationId`                | id decimal (≤18 dígitos, string)                                                                                                                                                                                                                                                       | hechos factuales + scores persistidos + `hasUsableSnapshot`                                                                                                                           | 400, 401, 404 `RESERVATION_NOT_FOUND`, 503                                                                                                                                                                                               |
| HU-02    | `GET /api/v1/reservations/:reservationId/risk`           | —                                                                                                                                                                                                                                                                                      | `status` (`AVAILABLE_EXPLORATORY`/`NOT_SCORED`/`NOT_SCORABLE`), `reasons`, `snapshot`, `models[]`, `comparison`, `riskLevel:null`, `riskPolicyStatus`, `sourceFreshness`, `message`   | 400, 401, 404, 503. **Nunca llama a Python**                                                                                                                                                                                             |
| HU-02    | `POST /api/v1/reservations/:reservationId/predictions`   | body `{"mode":"compare"}` o `{"mode":"single","modelKey":…}` (≤1 KiB)                                                                                                                                                                                                                  | 201 (run creado) / 200 (idempotente, `run.replayed=true`) + mismo cuerpo de riesgo + `run`, `featureWarnings`                                                                         | 400, 401, 404, 409 `NOT_SCORABLE`/`FEATURE_VERSION_MISMATCH`, 413, 422 `INVALID_FEATURES`, 429 `ML_RATE_LIMITED`, 502 `ML_CONTRACT_VIOLATION`, 503 `ML_UNAVAILABLE`/`ML_CREDENTIAL_REJECTED`/`PERSISTENCE_UNAVAILABLE`, 504 `ML_TIMEOUT` |
| HU-05    | `GET /api/v1/reservations/:reservationId/risk/factors`   | `modelKey`, `topK` (1–10, 5*)                                                                                                                                                                                                                                                          | modelo, `probabilityNoShow`, `persistedScore{available,sameModelIdentity}`, `explanation{outputSpace,outputLink,units,baseValue,…,factors[]}`, `interpretation` (no causal)           | 400, 401, 404, 409 `EXPLANATION_SNAPSHOT_UNAVAILABLE`, 429, 502, 503 `EXPLANATION_UNAVAILABLE`, 504                                                                                                                                      |
| HU-06    | `GET /api/v1/reservations/:reservationId/client-history` | `historicalAsOf` (`booking_creation`*/`current_known`)                                                                                                                                                                                                                                 | conteos, `noShowRate` (null sin historial), últimas fechas, `cutoffAt`, `cutoffSemantics`, `historySemantics:NO_SHOW_CANDIDATE`, `warnings`                                           | 400, 401, 404, 409 `HISTORY_CUTOFF_UNAVAILABLE`, 503                                                                                                                                                                                     |

(*) valor por defecto. Todas las respuestas incluyen `requestId` y la cabecera `x-request-id`
(se reutiliza un `X-Request-ID` entrante solo si es opaco: `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`).

## Sobre de error (handler global existente)

```json
{
  "error": {
    "code": "NOT_SCORABLE",
    "message": "…",
    "details": { "reasons": [{ "code": "SCHEDULED_SERVICES_NOT_POINT_IN_TIME", "message": "…" }] }
  },
  "requestId": "…"
}
```

Mapeo: `NotFound`→404, `Conflict`→409, `InvalidOperation`/`ValidationException`→422, validación
Fastify→400 (`REQUEST_VALIDATION_ERROR`), `Unauthorized`→401, infraestructura→503 (mensaje
genérico), `UpstreamRateLimited`→429, `UpstreamContract`→502, `UpstreamTimeout`→504.

## Ejemplo de listado (valores **sintéticos**, modo `SYNTHETIC_DEMO_ONLY`)

```json
{
  "data": [
    {
      "reservationId": "900000000001002",
      "clientId": "900000000002002",
      "clinicId": 2,
      "appointmentAt": "2026-11-12T15:00:00.000Z",
      "bookingCreatedAt": "2026-10-20T16:00:00.000Z",
      "reservationStatus": "SCHEDULED",
      "sourceClassification": "FUTURE_PENDING",
      "hasRescheduleEvent": false,
      "classificationCutoffAt": "2026-10-08T01:58:00.000Z",
      "sourceFreshness": "CURRENT",
      "risk": {
        "predictionAvailability": "AVAILABLE_EXPLORATORY",
        "notScorableReasons": [],
        "riskLevel": null,
        "riskPolicyStatus": "pending_validation",
        "classificationUnavailable": true,
        "validationStatus": "EXPLORATORY_NOT_VALIDATED",
        "probabilities": [
          {
            "modelKey": "random_forest_full_v1",
            "modelVersion": "random_forest_full_v1:4e3c86a17005",
            "modelHash": "4e3c86a17005",
            "probabilityNoShow": 0.31,
            "percentageNoShow": 31,
            "scoredAt": "…",
            "predictionRunId": "…",
            "riskLevel": null
          }
        ]
      }
    }
  ],
  "pagination": { "limit": 25, "nextCursor": null },
  "sort": {
    "field": "probabilityNoShow",
    "direction": "desc",
    "modelKey": "random_forest_full_v1",
    "semantics": "EXPLORATORY_SCORE_ORDER"
  },
  "riskPolicyStatus": "pending_validation",
  "classificationUnavailable": true,
  "sourceStatus": "SYNTHETIC_DEMO_ONLY",
  "predictiveStoreAvailable": true,
  "requestId": "…"
}
```

Los números son ilustrativos. `percentageNoShow = 100·probabilityNoShow` solo para visualizar; la
probabilidad original no se redondea. Un `null` de probabilidad significa «no evaluada», nunca 0.
