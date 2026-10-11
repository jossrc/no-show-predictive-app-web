# no-show-predictive-app-web — Backend (Sprint 01)

Backend Fastify 5 + TypeScript del **sistema web predictivo de inasistencias** (TESIS 2026–2027).
Sprint 01 «Core Predictivo»: HU-01, HU-02, HU-03, HU-05 y HU-06. Integra el microservicio
`depi-noshow-ml` (Random Forest, XGBoost y SHAP) sin modificarlo.

> ⚠️ Las probabilidades son **estimaciones exploratorias no calibradas** (`EXPLORATORY_NOT_VALIDATED`).
> No existe política aprobada de niveles: `riskLevel` es siempre `null` y no hay semáforo operativo.
> Con la réplica actual de FLOWww ninguna reserva real puede demostrar su foto al reservar, por lo
> que en datos reales la API responde `NOT_SCORABLE` con motivos (ver `docs/sprint-01/source_inventory.md`).

## Arquitectura

Screaming Architecture + Vertical Slices (`src/modules/<Módulo>/<Feature>/{application,presentation}`),
handlers `handle()`, operaciones `execute()`, `*Module.ts` como composition root. Módulos:
`Health`, `FlowMigration` (existentes), `Reservations`, `ReservationRisk`, `ClientHistory`,
`PredictionModels`. Detalle: [`docs/sprint-01/architecture.md`](docs/sprint-01/architecture.md).

## Requisitos

Node ≥ 24.20, npm, Docker (PostgreSQL). Python solo si se usa la predicción (repo `depi-noshow-ml`).

## Puesta en marcha

```bash
npm ci
cp .env.example .env          # completar credenciales locales (no versionar)
# Credencial interna provisional (no es login): guardar KEY en el servidor consumidor, solo el hash aquí
node -e "const k=require('crypto').randomBytes(32).toString('base64url');console.log('KEY='+k);console.log('SHA256='+require('crypto').createHash('sha256').update(k).digest('hex'))"
#   → INTERNAL_API_KEY_SHA256=<SHA256> en .env
npm run migrate:app -- --dry-run   # revisar; luego `npm run migrate:app` cuando se autorice (solo schema ml)
npm run dev
```

Python (otra terminal, ver `docs/sprint-01/ml_integration.md`): levantar `depi-noshow-ml` en
`127.0.0.1:8001` y poner la misma clave en `ML_SERVICE_KEY` del `.env` de Node.

Comprobación sin revelar secretos (la clave se lee de una variable de entorno de la terminal):

```bash
curl -s http://127.0.0.1:3000/api/health/postgres
curl -s http://127.0.0.1:3000/api/v1/health/ml
curl -s -H "x-api-key: $INTERNAL_API_KEY" "http://127.0.0.1:3000/api/v1/reservations?from=2026-10-12&to=2026-10-31&limit=5"
```

## API Sprint 01 (`/api/v1`, requiere `x-api-key`)

| Método | Ruta                               | HU                                                        |
| ------ | ---------------------------------- | --------------------------------------------------------- |
| GET    | `/reservations`                    | HU-01/03 listado paginado, filtros, orden exploratorio    |
| GET    | `/reservations/:id`                | detalle factual + scores persistidos                      |
| GET    | `/reservations/:id/risk`           | HU-02 lectura (sin llamar a Python)                       |
| POST   | `/reservations/:id/predictions`    | HU-02 acción explícita idempotente (`{"mode":"compare"}`) |
| GET    | `/reservations/:id/risk/factors`   | HU-05 SHAP bajo demanda                                   |
| GET    | `/reservations/:id/client-history` | HU-06 historial as-of                                     |
| GET    | `/ml/models`                       | identidad de modelos                                      |
| GET    | `/health/ml`                       | disponibilidad ML (sin credencial)                        |

Contrato completo y errores: [`docs/sprint-01/api_contract.md`](docs/sprint-01/api_contract.md).

## Documentación interactiva — Scalar API Reference

Con `NODE_ENV=development`, iniciar como siempre con `npm run dev` y abrir:

- Scalar: [http://127.0.0.1:3000/docs](http://127.0.0.1:3000/docs).
- OpenAPI JSON: [http://127.0.0.1:3000/docs/openapi.json](http://127.0.0.1:3000/docs/openapi.json).
- OpenAPI YAML: [http://127.0.0.1:3000/docs/openapi.yaml](http://127.0.0.1:3000/docs/openapi.yaml).

El contrato OpenAPI 3.1 se genera dinámicamente desde los JSON Schemas de las rutas efectivamente
registradas. La documentación es pública en desarrollo y sus rutas no se registran en `test` ni
`production`. El plugin sirve su bundle de Scalar desde el propio backend.

Para ejecutar peticiones de negocio desde el cliente HTTP integrado, seleccionar `InternalApiKey`
en la autenticación de Scalar e introducir la clave original en texto plano: se envía como
`x-api-key`, sin prefijo Bearer. El hash `INTERNAL_API_KEY_SHA256` y la credencial interna de Python
no son claves para introducir en Scalar. No se preconfiguran ni persisten credenciales en el
navegador. Elegir una operación, completar sus parámetros o cuerpo y usar **Send**. Las rutas de
salud no requieren autenticación. Las rutas de negocio aparecen únicamente si están habilitadas
y se configuró su credencial provisional.

Los ejemplos de petición son sintéticos. Las estimaciones continúan siendo exploratorias,
sin validación para uso operativo ni política aprobada de niveles de riesgo (`riskLevel=null`).
La integración queda pendiente de revisión manual; no se ejecutaron pruebas ni verificaciones
de arranque o HTTP durante su implementación.

## Pruebas

```bash
npm run check                 # typecheck + format:check + unit/contract/e2e + build
npm run test:db:up            # PostgreSQL de PRUEBA aislado (127.0.0.1:55432, tmpfs)
npm run test:integration      # SQL, migraciones, paridad ETL, E2E con BD
npm run demo:seed-synthetic   # datos sintéticos de demo en la BD de prueba
```

Ver [`docs/sprint-01/testing.md`](docs/sprint-01/testing.md). Nunca ejecutar
`docker compose down -v` sobre `docker-compose.yml` (volumen con datos reales).

## Documentación Sprint 01

`docs/sprint-01/`: scope, architecture, source_inventory, feature_lineage, api_contract,
ml_integration, database, testing, performance, acceptance_matrix, implementation_report.
Decisiones: `docs/adr/ADR-001…005`.
