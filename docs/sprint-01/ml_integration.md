# Sprint 01 — Integración con `depi-noshow-ml` (FastAPI)

## Contrato anclado

| Elemento                                      | Valor                                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Repositorio / commit                          | `jossrc/depi-noshow-ml` @ `f2f30b5f4cbc86e166da9129efdc721594f3a4` (no modificado)                                                |
| OpenAPI copiado                               | `tests/contracts/ml/ml-internal-v1.openapi.json`                                                                                  |
| SHA-256 anclado                               | `706d6aa310bcfc467c7a0f307d76b43b7f333054c45f7fab0f1555c0dd2138d8`                                                                |
| Tipos TS de referencia (no usados en runtime) | `ml-internal-v1.types.ts` SHA-256 `3978a8c0…6de`                                                                                  |
| Features                                      | `BOOKING_BASELINE_V1`, 19 predictoras (`PREDICTOR_COLUMNS` de `schema.py`), `snapshot_type=booking_creation`                      |
| Modelos                                       | `random_forest_full_v1` (hash `4e3c86a17005`, default demo) y `xgboost_full_v1` (`376d3db9d4d3`)                                  |
| Estado                                        | `EXPLORATORY_NOT_VALIDATED`, `calibration_status=not_operationally_validated`, `risk_level=null`, `operational_use_allowed=false` |

`npm run test:contract` verifica el SHA, las rutas, las 19 predictoras en orden, que los
validadores Zod cubren **exactamente** las propiedades de cada respuesta del OpenAPI, que las
peticiones construidas por el builder validan contra el OpenAPI (AJV) y que los goldens sintéticos
cumplen ambos. Con `ML_CONTRACT_SOURCE_PATH=<repo Python>/docs/contracts/ml-internal-v1.openapi.json`
compara además contra el repo vivo (verificado: idéntico). Un cambio en Python exige re-anclar a mano.

## Cliente (`src/infrastructure/http/ml/`)

| Archivo                                           | Responsabilidad                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MlPredictionClient.ts`                           | Interfaz inyectable: `getModels`, `predict`, `compare`, `explain`, `batch`, `ready`                                                                                                                                                                                                                            |
| `HttpMlPredictionClient.ts`                       | `fetch` nativo; `X-Service-API-Key` solo hacia Python; `X-Request-ID` opaco; `redirect: 'error'`; cuerpos construidos campo a campo; respuesta ≤1 MiB                                                                                                                                                          |
| `MlContractSchemas.ts` / `MlContractValidator.ts` | Zod 4 estricto + reglas semánticas: RF→XGB en compare, algoritmo↔modelo, diferencia descriptiva, SHAP (orden por magnitud, dirección↔signo, reconstrucción ±1e-6, aditividad RF 1e-7 / XGB 1e-5, salida RF = p ±1e-9, sigmoid(XGB) = p ±1e-6), batch (índices 0..n-1, `count`), catálogo (19 columnas exactas) |
| `MlHttpErrorMapper.ts`                            | 400→502 `ML_REQUEST_REJECTED`; 401→503 `ML_CREDENTIAL_REJECTED`; 404 `UNKNOWN_MODEL`→503 `ML_MODEL_UNAVAILABLE`; 409→409 `FEATURE_VERSION_MISMATCH`; 413→502; 422→422 `INVALID_FEATURES` (solo campo+motivo); 429→429; 500/503 de explain→503 `EXPLANATION_UNAVAILABLE`; resto→503                             |
| `MlTimeoutPolicy.ts`                              | Presupuesto: 5 s inferencia, 10 s explicación (configurables). **Sin reintento** tras timeout: el cómputo Python puede seguir                                                                                                                                                                                  |
| `MlServiceUrl.ts`                                 | URL fija validada: loopback o allowlist explícita, sin credenciales/ruta/query; `https` en production (anti-SSRF)                                                                                                                                                                                              |
| `CachedMlModelCatalog.ts`                         | Catálogo con TTL 60 s y carga única concurrente; base de la idempotencia por versión                                                                                                                                                                                                                           |
| `UnconfiguredMlPredictionClient.ts`               | Sin `ML_SERVICE_KEY`: `ML_NOT_CONFIGURED` (el listado sigue funcionando)                                                                                                                                                                                                                                       |
| `../../resilience/ConcurrencyLimiter.ts`          | Cupos: 2 inferencias y 1 SHAP concurrentes, cola 8 ⇒ 429 local inmediato                                                                                                                                                                                                                                       |
| `../../resilience/CircuitBreaker.ts`              | 5 fallos 5xx/transporte consecutivos ⇒ OPEN 30 s ⇒ HALF_OPEN con una sonda                                                                                                                                                                                                                                     |

Logs (`event: ml_request`): `requestId`, operación, ruta de contrato, estado, duración, estado del
circuito, modelo y hash corto. **Nunca** features, IDs de cliente, cabeceras ni la clave.

## SHAP (HU-05)

RF explica en `probability` (enlace identidad); XGB en `log_odds` (enlace sigmoide): las escalas no
son comparables y los log-odds **no** son puntos porcentuales (la respuesta lo indica en `units`).
La explicación se pide al abrir el detalle (una llamada por modelo), con las mismas 19 features del
snapshot persistido; no se cachea ni persiste, y un fallo de SHAP no altera el score guardado.
`age_at_booking` y `client_sex` se marcan `sensitiveAttribute=true`.

## Verificación real (loopback)

Instancia de desarrollo propia en `127.0.0.1:8002` con clave efímera aleatoria (no impresa) y los
flags documentados por el repo Python. `ML_RUN_REAL_INTEGRATION=1 npm run test:integration`:
readiness/catálogo, paridad de la fixture artificial (RF 0.6976400433344135 ±1e-10, XGB
0.9159286618232727 ±1e-6), features del builder aceptadas (single/compare/batch), SHAP RF/XGB y
401 ⇒ `ML_CREDENTIAL_REJECTED`: **PASS**. Hallazgo corregido durante esta verificación: el cliente
reenviaba propiedades extra en `batch` y Python las rechazaba (422); ahora construye los cuerpos
solo con campos del contrato (test de regresión en `MlPredictionClient.test.ts`).

## Arranque local de Python (resumen; ver `depi-noshow-ml/docs/api_operations.md`)

```bash
# terminal del repo Python (no editar su código)
export ML_API_ENV=development ML_API_MODE=exploratory_demo ML_ALLOW_EXPERIMENTAL_INFERENCE=true
export ML_MODEL_REFERENCE_DIR=experiments/phase2-exploratory-prompt5-20261008
export ML_MODEL_MANIFEST_SHA256=ae7627340fe5207238da86f0db3d5ebc2b31250a1e4460c7926f169b5c658aac
export ML_DEFAULT_MODEL_KEY=random_forest_full_v1 ML_ENABLE_LOCAL_EXPLANATIONS=true ML_MAX_BATCH_ITEMS=32
export ML_API_SERVICE_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
uvicorn 'depi_ml.api.main:create_app' --factory --host 127.0.0.1 --port 8001 --no-access-log --log-config examples/uvicorn_logging.json
```

En Node: `ML_SERVICE_URL=http://127.0.0.1:8001` y `ML_SERVICE_KEY` = misma clave (solo en el
entorno del proceso Node; nunca en el navegador ni en el repositorio).

## Problemas frecuentes

| Síntoma                              | Causa probable                                                    |
| ------------------------------------ | ----------------------------------------------------------------- |
| `GET /api/v1/health/ml` → `disabled` | Falta `ML_SERVICE_KEY`                                            |
| 503 `ML_CREDENTIAL_REJECTED`         | Clave Node ≠ `ML_API_SERVICE_KEY` de Python                       |
| 503 `ML_CIRCUIT_OPEN`                | ≥5 fallos seguidos; esperar 30 s o revisar Python                 |
| 503 `EXPLANATION_UNAVAILABLE`        | Python sin `ML_ENABLE_LOCAL_EXPLANATIONS=true`                    |
| 502 `ML_CONTRACT_VIOLATION`          | Release Python distinto del contrato anclado: revisar y re-anclar |
