# Sprint 01 — Contrato HTTP (implementado)

Prefijo existente `/api`; rutas nuevas versionadas en `/api/v1`. Rutas existentes intactas:
`GET /api/health/postgres`, `GET /api/health/mysql`.

## OpenAPI dinámico y Scalar

El backend genera OpenAPI **3.1.0** desde los JSON Schemas de las rutas registradas, sin mantener
un contrato estático duplicado. Solo en `NODE_ENV=development` están disponibles:

- Scalar API Reference: `http://127.0.0.1:3000/docs`.
- Especificación JSON: `http://127.0.0.1:3000/docs/openapi.json`.
- Especificación YAML: `http://127.0.0.1:3000/docs/openapi.yaml`.

Scalar sirve el bundle local y permite ejecutar solicitudes con el esquema `InternalApiKey`
(`type=apiKey`, cabecera `x-api-key`), introduciendo la clave original sin Bearer ni credenciales
de Python. No contiene valores secretos ni activa persistencia de autenticación. Health es público;
las operaciones de negocio conservan su compuerta provisional. La UI y ambas especificaciones no
se registran en `test` ni `production`.

La superficie documentada depende de la composición real: las rutas predictivas pueden no estar
registradas si están deshabilitadas o falta la credencial; Health ML depende de su registro.
Health MySQL permanece registrado incluso sin conexión configurada (200 con `status=disabled`).
Los tipos anulables y los códigos HTTP se conservan. Los ejemplos de petición son sintéticos;
las probabilidades siguen siendo exploratorias, con `riskLevel=null` (operativo) y política
pendiente de validación; la banda experimental va aparte en `experimentalRisk`. Verificado el
2026-10-11 con `npm run dev` real: `/docs` 200 y `/docs/openapi.json` con 13 rutas (incluye
`/api/v1/ml/research-risk-policy` y `/api/v1/health/predictive-store`, y el parámetro
`experimentalRiskLevel`).

## Autenticación provisional

Todas las rutas de negocio exigen `x-api-key` (credencial interna ≥ 32 caracteres; el servidor
guarda solo su SHA-256 en `INTERNAL_API_KEY_SHA256` y compara en tiempo constante). Se evalúa en
`onRequest`: **401 uniforme** antes de validar parámetros (no revela existencia de reservas).
Sin `INTERNAL_API_KEY_SHA256` las rutas no se registran (404). En `production` el arranque se
rechaza (`AUTH_FULL_FLOW_PENDING_HU21_HU22`) salvo `PREDICTIVE_API_ENABLED=false`.
**No es login (HU-21) ni RBAC (HU-22).** En la aplicación web el consumidor es un servidor
(p. ej. Next.js server-side), que conserva la clave fuera del navegador. En desarrollo, Scalar
permite introducirla manualmente para ejecutar solicitudes al mismo backend, sin persistirla.
Sin CORS habilitado para las rutas de negocio; el plugin limita sus cabeceras CORS documentales
a las especificaciones disponibles en desarrollo.

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

## Actualización 2026-10-11 — banda EXPERIMENTAL research v2 (aditivo, sin romper clientes)

Todos los campos existentes se conservan con su significado. `riskLevel` sigue siendo el riesgo
**operativo** y permanece `null`; la banda experimental se expone en campos **nuevos**.

| Endpoint                                               | Cambio aditivo                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/ml/research-risk-policy` (nuevo)          | `{nodeResearchRiskEnabled, available, status, reason, classificationBasis, approvedRiskPolicyStatus, validationStatus, operationalUseAllowed:false, labels, notice, policies[]}`; cada política: modelo, SHA-256, `policyId/Version/Hash`, `lowUpperThreshold`, `highLowerThreshold`, `boundaryRule`, `method`, `meaning`, ventana de desarrollo, `developmentRows`, ECE, `warnings`, `approvedBy:null`. 200 también si UNAVAILABLE (con `reason`); 503/502/504 si Python no responde. |
| `GET /api/v1/health/predictive-store` (nuevo, público) | `{service, status, message, driver:'sqlite', schemaVersion, dataSourceMode, durable, sourceDatabaseWritable:false}` (503 si `status=error`).                                                                                                                                                                                                                                                                                                                                           |
| `GET /api/v1/ml/models`                                | `experimentalRiskPolicy{status, available, reason, classificationBasis, operationalUseAllowed:false, policies[{modelKey, policyId, policyVersion, policyHash}]}`; un fallo del catálogo v2 no oculta los modelos.                                                                                                                                                                                                                                                                      |
| `POST …/predictions`                                   | Con `ML_RESEARCH_RISK_ENABLED=true` usa `/internal/v2`; cada `models[]` trae `experimentalRisk` (objeto completo), `modelHashSha256`, `scoringApiVersion:'v2'`. Política no disponible ⇒ **503 `RESEARCH_RISK_POLICY_NOT_READY`** con `details:{field:'experimental_risk', reason}`; respuesta v2 incoherente con el catálogo ⇒ 502 sin persistir. Idempotente por snapshot+modelo+versión+política.                                                                                   |
| `GET …/risk` y cuerpo del POST                         | Raíz: `operationalClassificationUnavailable`, `experimentalClassificationUnavailable`, `classificationBasis` (`RESEARCH_PROVISIONAL`/null), `experimentalRiskNotice`. `classificationUnavailable` = sin clasificación operativa **ni** experimental. Por modelo: `experimentalRisk` o `null` + `experimentalRiskUnavailableReason:'SCORED_WITHOUT_RESEARCH_POLICY'`.                                                                                                                   |
| `GET /api/v1/reservations`                             | Query `experimentalRiskLevel=LOW                                                                                                                                                                                                                                                                                                                                                                                                                                                       | MEDIUM | HIGH`y`sort=experimentalRisk`(por el`modelKey`elegido). Raíz:`experimentalRiskPolicy`(política vigente usada, firmada en el cursor) o`null`, `operationalClassificationUnavailable`, `experimentalClassificationUnavailable`; `sort.semantics='EXPERIMENTAL_RESEARCH_BAND_ORDER'`. Item `risk`: `experimentalRisk`del modelo elegido,`experimentalPolicyCurrent`, ambos `…Unavailable`; cada `probabilities[]`trae`experimentalRisk`compacto.`riskLevel=…`/`sort=riskLevel`siguen ⇒ 409. Ranking > 50 000 reservas puntuadas por modelo ⇒ 422`RANKING_CANDIDATES_EXCEEDED`. |
| `GET /api/v1/reservations/:id`                         | `scores[].experimentalRisk` compacto.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `GET …/risk/factors`                                   | `persistedScore.experimentalRisk` (banda guardada; SHAP v1 no la recalcula).                                                                                                                                                                                                                                                                                                                                                                                                           |

### Semántica para la UI (Next.js) — handoff

- Mostrar la banda como **«Bajo/Medio/Alto (exploratorio)»** usando `experimentalRisk.label`, siempre
  junto al modelo (`modelKey`) y con el aviso `experimentalRiskNotice` / `experimentalRiskPolicy.notice`.
  Nunca derivar una banda común de RF y XGB, ni usar 0.5, ni calcular bandas en el cliente.
- `riskLevel` debe seguir interpretándose como «sin semáforo operativo aprobado». No hay alias: la UI
  no debe mapear `experimentalRisk` a `riskLevel`.
- Estados: `NOT_SCORED` ⇒ ofrecer la acción explícita POST; `NOT_SCORABLE` ⇒ mostrar `reasons[]` (sin
  score sustituto); 503 `RESEARCH_RISK_POLICY_NOT_READY` ⇒ «bandas experimentales no disponibles»
  (no mostrar LOW). `experimentalPolicyCurrent=false` ⇒ la banda es de otra versión de política.
- Filtros: `experimentalRiskLevel` + `modelKey`; paginación solo con `pagination.nextCursor` (un
  cursor de otra combinación de filtros/modelo/política ⇒ 422 `INVALID_CURSOR`).
- `operationalUseAllowed=false`: la UI no debe disparar acciones automáticas (recordatorios,
  bloqueos, sobreventa) a partir de la banda.

### Ejemplo real sintético (`SYNTHETIC_DEMO_ONLY`, Python v2 real, reserva 900000000101005)

Entrada sintética que reproduce `depi-noshow-ml/examples/prediction_compare.json`. Extracto de
`GET /api/v1/reservations/900000000101005/risk` → `data.models[0]` (RF):

```json
{
  "modelKey": "random_forest_full_v1",
  "modelVersion": "random_forest_full_v1:4e3c86a17005",
  "modelHash": "4e3c86a17005",
  "modelHashSha256": "4e3c86a170056146cf82a2cc109ae9051b81845608dbd58aae11e43d97492e08",
  "scoringApiVersion": "v2",
  "probabilityNoShow": 0.6976400433344135,
  "percentageNoShow": 69.76400433344135,
  "operationalUseAllowed": false,
  "riskLevel": null,
  "experimentalRisk": {
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
    "warnings": [
      "Relative raw-score bands, not validated absolute risks or cancellation probabilities.",
      "…"
    ],
    "approvedBy": null,
    "operationalUseAllowed": false
  },
  "experimentalRiskUnavailableReason": null
}
```

XGB del mismo snapshot: `0.9159286618232727`, `HIGH`, política `208c706d…7032`; diferencia descriptiva
`0.21828861848885917` (sin ganador ni ensemble). Ejemplo completo (riesgo, listado filtrado y
política) en `reports/node-closeout/example-api-synthetic.json` (local, no versionado).
