# Sprint 01 — Rendimiento (laboratorio)

> **No es SLA.** Medición local con datos sintéticos en la BD de prueba aislada. La tesis no fija
> un p95 de backend; estas cifras son una línea base de laboratorio.

## Entorno

Apple M1 Pro (10 núcleos), 32 GB, macOS 25.5 arm64, Node 24.20.0, PostgreSQL 18.4 en Docker
(tmpfs, `depi_noshow_test`), Python `depi-noshow-ml` (uvicorn, 1 worker) en 127.0.0.1:8002.
Reproducir: `npm run test:db:up && RUN_PERFORMANCE=1 [ML_RUN_REAL_INTEGRATION=1 …] npm run test:performance`.
Cada escenario: 5 de calentamiento + 30 mediciones (historial: 50; explain RF: 10) vía
`fastify.inject` (incluye routing, validación, serialización, BD).
Reporte bruto: `reports/performance/sprint01-<ts>.json` (no versionado).

## Listado `GET /api/v1/reservations` (período de 84 días)

Universo sintético: N reservas `FUTURE` en el período, la mitad con scores RF+XGB persistidos.

| N en el período | limit | Orden cronológico p50 / p95 / p99 (ms) | Orden por probabilidad p50 / p95 / p99 (ms) |
| --------------: | ----: | -------------------------------------- | ------------------------------------------- |
|           1 000 |    25 | 6,1 / 6,9 / 11,1                       | 10,9 / 19,4 / 21,0                          |
|           1 000 |   100 | 9,3 / 16,7 / 18,4                      | 9,8 / 11,7 / 12,1                           |
|          10 000 |    25 | 6,8 / 13,7 / 19,6                      | 24,1 / 39,2 / 45,8                          |
|          10 000 |   100 | 8,6 / 26,0 / 29,2                      | 30,4 / 46,2 / 59,8                          |
|         100 000 |     1 | 5,6 / 6,9 / 15,7                       | 159,7 / 166,7 / 173,5                       |
|         100 000 |    25 | 8,6 / 19,7 / 22,8                      | 166,4 / 177,0 / 182,0                       |
|         100 000 |   100 | 7,7 / 14,6 / 15,4                      | 168,5 / 177,7 / 189,7                       |

- Sentencias SQL por petición: 7 constantes (BEGIN, `SET TRANSACTION READ ONLY`,
  `statement_timeout`, `jit`, **1** SELECT de datos, COMMIT; sonda del schema ml cacheada 30 s),
  independientes del número de filas (**sin N+1**). Respuesta ≈ 24 KB con 25 filas.
- RSS del proceso de pruebas tras los escenarios: ≈ 227 MB.
- El orden cronológico usa `idx_outcomes_outcome` y se detiene en `LIMIT`. El orden por
  probabilidad debe evaluar el score de **todas** las citas del período (lateral indexado por fila,
  `top-N heapsort`): coste lineal. Referencia real: hay 8.887 reservas `FUTURE` en total; un período
  de 92 días contiene < 9 k ⇒ ~25–30 ms.

### Optimización con evidencia antes/después

`EXPLAIN (ANALYZE)` mostró que el JIT de PostgreSQL añadía 70–120 ms a esta consulta corta
(358/268 ms → 190 ms sin JIT, 100 k filas). Se aplicó `SET LOCAL jit = off` solo dentro de las
transacciones de lectura fuente:

| Escenario (limit 25, orden por probabilidad) | Antes p50 | Después p50 |
| -------------------------------------------- | --------: | ----------: |
| 10 000 en el período                         |   57,0 ms |     24,1 ms |
| 100 000 en el período                        |  496,6 ms |    166,4 ms |

También se eliminó un `Seq Scan` de `appointment_events` (ver `source_inventory.md`). No se
crearon índices en tablas reales.

## Historial as-of (`SequelizeClientHistoryRepository.summarizeAsOf`)

| Eventos del cliente | p50 / p95 / p99 (ms) |
| ------------------: | -------------------- |
|                   0 | 3,4 / 5,5 / 17,8     |
|                   1 | 2,7 / 5,9 / 7,6      |
|               1 000 | 2,6 / 6,7 / 10,1     |
|             100 000 | 3,3 / 8,8 / 10,6     |

Plan con 100 k eventos: `Index Only Scan using idx_ml_history_client_known_at`, 4 buffers,
0,047 ms de ejecución: no se traen eventos a Node.

## HTTP a Python real (loopback, entrada sintética)

| Operación          | p50 / p95 (ms) |
| ------------------ | -------------- |
| predict RF         | 22,0 / 35,8    |
| predict XGB        | 8,8 / 10,7     |
| compare RF+XGB     | 37,3 / 42,4    |
| explain RF (SHAP)  | 1 446 / 1 534  |
| explain XGB (SHAP) | 14,5 / 15,7    |

Concurrencia sobre `compare` (cupo Node 2 + cola 16; Python 2 inferencias):

| Peticiones simultáneas | Resultado                                       | Tiempo total |
| ---------------------: | ----------------------------------------------- | -----------: |
|                      5 | 5 OK                                            |       177 ms |
|                     10 | 10 OK                                           |       485 ms |
|                     25 | 18 OK, 7 `ML_RATE_LIMITED` (backpressure local) |       837 ms |
|                     50 | 18 OK, 32 `ML_RATE_LIMITED`                     |       832 ms |

Python nunca respondió 429: el limitador de Node aplica backpressure antes. El presupuesto de
explicación (10 s) cubre ~6× el p50 de SHAP RF; el de inferencia (5 s) es holgado. Son medidas de
laboratorio: el timeout definitivo debe medirse en el despliegue real.

## Limitaciones

Una sola máquina; Docker en macOS; sin tráfico de red real; datos sintéticos uniformes; muestras
pequeñas (30–50); el benchmark de BD no incluye la latencia de un pool compartido con otras cargas.
