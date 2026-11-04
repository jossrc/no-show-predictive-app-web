# Sprint 02 · Handoff para el frontend (`no-show-predictive-app-fe`)

Guía secuencial para implementar las pantallas de HU-06/07/08 **sin reconstruir decisiones del
backend**. Contrato exacto: [`api-contract.md`](api-contract.md); OpenAPI: [`openapi.json`](openapi.json).
El backend ya calcula la elegibilidad y valida todo: el FE solo muestra, confirma y envía.

## 0. Acceso y seguridad

- Todas las rutas de negocio usan la cabecera `x-api-key` (credencial **interna provisional**,
  servicio a servicio). **Nunca** exponerla en el navegador: llamar desde el servidor del FE (p. ej.
  route handlers / server actions de Next.js) que añade la cabecera. No es login de usuarios:
  HU-21/HU-22 (login/RBAC) siguen pendientes; el backend registra `actorKind="INTERNAL_SERVICE"` y
  `actorUserId=null`. No enviar nombres de usuario: el backend no los acepta.
- IDs como `string` (nunca `Number`). Fechas de respuesta en UTC; mostrar en hora de Lima.

## 1. Listado de reservas (sin cambios de uso)

`GET /api/v1/reservations?from=YYYY-MM-DD&to=YYYY-MM-DD[&modelKey=…&experimentalRiskLevel=HIGH…]`

Cada fila trae ahora (aditivo) `overbooking`, `attendanceOutcome`, `spaceRecoveryOutcome`:

- Insignia «Habilitado para sobreasignación» si `row.overbooking?.enabled === true`
  (texto en `row.overbooking.statusLabel`).
- Si los tres objetos son `null` y `predictiveStoreAvailable === false`: mostrar «estado de gestión
  no disponible», **no** «no habilitado».
- No confundir `reservationStatus` (estado FLOWww: SCHEDULED/CANCELLED/PAST) con la gestión propia.

## 2. Detalle de riesgo

`GET /api/v1/reservations/{id}` (mismos tres objetos) y `GET /api/v1/reservations/{id}/risk`
(scores, bandas experimentales por modelo, `predictionRunId`). RF y XGB se muestran por separado;
nunca combinarlos ni elegir «ganador».

## 3. Botón HU-06 «Habilitar para sobreasignación»

1. Al abrir el detalle: `GET /api/v1/reservations/{id}/overbooking-authorization`.
2. Mostrar el botón **solo si** `data.eligibility.eligible === true`. Si `data.enabled === true`,
   mostrar el estado «Habilitado para sobreasignación» (`data.authorization.enabledAt`, modelo usado)
   y ocultar el botón.
3. Si no es elegible, mostrar (opcional) los motivos `eligibility.reasons[].message` y
   `candidates[].reasons[].message` (ya vienen en español).
4. Elegir el candidato: el que el supervisor esté viendo (`modelKey`) entre los
   `eligibility.candidates` con `eligible === true`. Si ambos lo son, permitir elegir modelo; no
   promediar.
5. Pedir **confirmación explícita** al supervisor indicando que es una marca para análisis del
   Call Center (no crea citas ni libera agenda; la banda es experimental, no validada).
6. `POST /api/v1/reservations/{id}/overbooking-authorizations` con
   `{"modelKey": candidate.modelKey, "predictionRunId": candidate.predictionRunId}`.
7. `201` o `200` (`replayed`) ⇒ éxito: refrescar detalle, GET de estado y listado.
8. Errores:
   - `409 OVERBOOKING_NOT_ELIGIBLE` con `PREDICTION_NOT_LATEST` u otros motivos ⇒ «La información
     cambió, se actualizará», volver al paso 1.
   - `409 OVERBOOKING_ALREADY_ENABLED_CONFLICT` ⇒ ya habilitado con otra predicción: refrescar.
   - `409 PREDICTION_RESERVATION_MISMATCH` ⇒ refrescar (datos inconsistentes en la vista).
   - `401` ⇒ problema de configuración del servidor FE; `404` ⇒ reserva no accesible;
     `503` ⇒ «servicio no disponible, reintente» (reintentar es seguro: es idempotente).
9. Deshabilitar el botón mientras la petición está en curso (aunque el backend ya evita duplicados).

## 4. Lista HU-06

`GET /api/v1/overbooking-authorizations?from=&to=[&clinicId=&limit=&cursor=]`: tabla de horarios
habilitados (fecha de cita en Lima, sede, modelo, probabilidad al habilitar, fecha de habilitación).
Paginación: pasar `pagination.nextCursor` en `cursor` **con los mismos filtros**; `null` = fin.
`422 INVALID_PERIOD` (máx. 92 días), `UNKNOWN_CLINIC`, `INVALID_CURSOR` ⇒ mensaje de filtro inválido.

## 5. Registro HU-07 «¿Asistió?»

1. `GET /api/v1/reservations/{id}/attendance-outcome`.
2. Si `recorded === true`: mostrar `attendanceStatus` (Asistió / No asistió) y la tabla
   `outcome.comparisons` por modelo: probabilidad, «predijo inasistencia» (`predictedNoShow`),
   «coincide» (`matchesPrediction`). Mostrar siempre `outcome.comparisonNotice` (umbral 0,5
   provisional, no validado).
3. Si `recorded === false` y `registration.registrable === true`: formulario con dos opciones
   `ATTENDED` / `NO_SHOW`. No ofrecer «cancelada» (no es un resultado de asistencia).
   `predictionRunId`: usar `registration.availablePredictionRunIds[0]` (o permitir elegir si hay
   varios; muéstrese el run de la predicción vista en el detalle).
4. Si `registrable === false`, mostrar el motivo según `registration.blocker`:
   `APPOINTMENT_NOT_STARTED` / `APPOINTMENT_IN_PROGRESS` («disponible cuando termine la cita»),
   `APPOINTMENT_END_UNKNOWN` («la agenda no acredita el fin de la cita»), `RESERVATION_CANCELLED`,
   `PREDICTION_REQUIRED` («primero genere una predicción»), `ALREADY_RECORDED`.
5. `POST /api/v1/reservations/{id}/attendance-outcomes` con
   `{"attendanceStatus": "ATTENDED" | "NO_SHOW", "predictionRunId": "…"}`; confirmar antes (el
   registro no se puede corregir en Sprint 02).
6. `201`/`200` ⇒ refrescar. `409 ATTENDANCE_ALREADY_RECORDED_CONFLICT` ⇒ ya existe otro valor:
   refrescar y mostrar el registrado. Otros `409` (ver contrato §3.2) ⇒ mostrar `error.message`.

## 6. Registro HU-08 «¿Se recuperó el espacio?»

1. `GET /api/v1/reservations/{id}/space-recovery-outcome`.
2. Mostrar Sí/No **solo si** `registrable === true` (implica `preventiveAction.enabled === true`).
   Si `blocker === 'PREVENTIVE_ACTION_REQUIRED'` ⇒ «El horario no fue habilitado (HU-06)».
3. `recorded === true` ⇒ mostrar «Recuperado» si `spaceRecovered === true`, «No recuperado» si
   `false`. `spaceRecovered === null` ⇒ «Sin registro» (nunca mostrar como «No»).
4. `POST /api/v1/reservations/{id}/space-recovery-outcomes` con `{"spaceRecovered": true|false}`
   (booleano JSON, no string). Errores: `409 PREVENTIVE_ACTION_REQUIRED`,
   `409 SPACE_RECOVERY_ALREADY_RECORDED_CONFLICT` ⇒ refrescar.
5. HU-08 no depende de HU-07: puede registrarse antes o después de la asistencia.

## 7. Errores comunes

| HTTP                           | Acción FE                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| 400 `REQUEST_VALIDATION_ERROR` | Error de programación del FE: revisar `error.errors[]` (`field`, `code`, `source`). |
| 401                            | Credencial del servidor FE ausente/incorrecta (no mostrar detalles al usuario).     |
| 404 `RESERVATION_NOT_FOUND`    | «Reserva no encontrada».                                                            |
| 409                            | Conflicto de negocio: mostrar `error.message`; refrescar estado.                    |
| 413                            | Cuerpo excesivo (no debería ocurrir).                                               |
| 422                            | Filtros de listado inválidos.                                                       |
| 503                            | Servicio/almacén no disponible: permitir reintento (POST idempotentes).             |

Registrar siempre `requestId` (cuerpo y cabecera `x-request-id`) para soporte.

## 8. Tipos TypeScript sugeridos (derivados de los JSON Schemas)

```ts
export type ModelKey = 'random_forest_full_v1' | 'xgboost_full_v1';
export type ExperimentalLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export interface Envelope<T> {
  data: T;
  requestId: string;
}
export interface ApiError {
  error: {
    code: string;
    message: string;
    errors?: Array<{ field: string; code: string; message: string; source: string }>;
    details?: Record<string, unknown>;
  };
  requestId: string;
}
export interface Reason {
  code: string;
  message: string;
}

export interface OverbookingSummary {
  enabled: boolean;
  status: 'ENABLED' | 'NOT_ENABLED';
  statusLabel: string;
  authorizationId: string | null;
  enabledAt: string | null;
  modelKey: ModelKey | null;
  predictionRunId: string | null;
}
export interface AttendanceSummary {
  recorded: boolean;
  attendanceStatus: 'ATTENDED' | 'NO_SHOW' | null;
  recordedAt: string | null;
}
export interface SpaceRecoverySummary {
  recorded: boolean;
  spaceRecovered: boolean | null;
  recordedAt: string | null;
}
/** Añadido a cada fila de GET /reservations y al detalle GET /reservations/:id. */
export interface OperationalStatus {
  overbooking: OverbookingSummary | null;
  attendanceOutcome: AttendanceSummary | null;
  spaceRecoveryOutcome: SpaceRecoverySummary | null;
}

export interface OverbookingAuthorization {
  authorizationId: string;
  reservationId: string;
  clinicId: number;
  appointmentAt: string;
  status: 'ENABLED';
  statusLabel: string;
  enabledAt: string;
  modelKey: ModelKey;
  modelVersion: string;
  predictionRunId: string;
  riskBandAtAuthorization: 'HIGH';
  probabilityNoShowAtAuthorization: number;
  researchPolicyHash: string;
  researchPolicyVersion: string;
  scoredAt: string;
  eligibilityRuleVersion: 'overbooking_eligibility_v1';
  actorKind: 'INTERNAL_SERVICE';
  actorUserId: null;
}
export interface OverbookingCandidate {
  modelKey: ModelKey;
  predictionRunId: string;
  probabilityNoShow: number;
  scoredAt: string;
  experimentalRiskLevel: ExperimentalLevel | null;
  researchPolicyHash: string | null;
  eligible: boolean;
  reasons: Reason[];
}
export interface OverbookingState {
  reservationId: string;
  enabled: boolean;
  status: 'ENABLED' | 'NOT_ENABLED';
  statusLabel: string;
  authorization: OverbookingAuthorization | null;
  eligibility: {
    ruleVersion: 'overbooking_eligibility_v1';
    eligible: boolean;
    reasons: Reason[];
    candidates: OverbookingCandidate[];
  };
}
export type EnableOverbookingRequest = { modelKey: ModelKey; predictionRunId: string };
export type EnableOverbookingResponse = Envelope<
  OverbookingAuthorization & { enabled: true; replayed: boolean }
>;

export interface AttendanceComparison {
  modelKey: ModelKey;
  modelVersion: string;
  probabilityNoShow: number;
  scoredAt: string;
  experimentalRiskLevel: ExperimentalLevel | null;
  comparisonRuleVersion: 'binary_outcome_threshold_v1';
  threshold: number;
  predictedNoShow: boolean;
  observedNoShow: boolean;
  matchesPrediction: boolean;
}
export interface AttendanceOutcome {
  attendanceOutcomeId: string;
  reservationId: string;
  clinicId: number;
  appointmentAt: string;
  appointmentEndAt: string | null;
  attendanceStatus: 'ATTENDED' | 'NO_SHOW';
  observedNoShow: boolean;
  recordedAt: string;
  predictionRunId: string;
  finishedRuleVersion: 'appointment_finished_rule_v1';
  comparisons: AttendanceComparison[];
  comparisonNotice: string;
  actorKind: 'INTERNAL_SERVICE';
  actorUserId: null;
}
export type AttendanceBlocker =
  | 'ALREADY_RECORDED'
  | 'RESERVATION_CANCELLED'
  | 'APPOINTMENT_NOT_STARTED'
  | 'APPOINTMENT_IN_PROGRESS'
  | 'APPOINTMENT_END_UNKNOWN'
  | 'PREDICTION_REQUIRED';
export interface AttendanceState {
  reservationId: string;
  recorded: boolean;
  attendanceStatus: 'ATTENDED' | 'NO_SHOW' | null;
  outcome: AttendanceOutcome | null;
  registration: {
    ruleVersion: 'appointment_finished_rule_v1';
    registrable: boolean;
    blocker: AttendanceBlocker | null;
    availablePredictionRunIds: string[];
  };
}
export type RecordAttendanceRequest = {
  attendanceStatus: 'ATTENDED' | 'NO_SHOW';
  predictionRunId: string;
};

export interface SpaceRecoveryOutcome {
  recoveryOutcomeId: string;
  authorizationId: string;
  reservationId: string;
  clinicId: number;
  appointmentAt: string;
  spaceRecovered: boolean;
  recordedAt: string;
  actorKind: 'INTERNAL_SERVICE';
  actorUserId: null;
}
export interface SpaceRecoveryState {
  reservationId: string;
  recorded: boolean;
  spaceRecovered: boolean | null;
  outcome: SpaceRecoveryOutcome | null;
  preventiveAction: { enabled: boolean; authorizationId: string | null };
  registrable: boolean;
  blocker: 'PREVENTIVE_ACTION_REQUIRED' | 'ALREADY_RECORDED' | null;
}
export type RecordSpaceRecoveryRequest = { spaceRecovered: boolean };

export interface RecordList<T> {
  data: T[];
  pagination: { limit: number; nextCursor: string | null };
  period: {
    from: string;
    to: string;
    timeZone: string;
    startInclusive: string;
    endExclusive: string;
  };
  requestId: string;
}
```

## 9. Pruebas manuales en Scalar y modo sintético (sin tocar datos reales)

1. Base sintética del almacén: crear una base en el clúster de **prueba** (`npm run test:db:up`,
   puerto 55432) con roles (`roles.sql`), migrarla con `DATA_SOURCE_MODE=SYNTHETIC_DEMO_ONLY` y
   arrancar: `NODE_ENV=development DATA_SOURCE_MODE=SYNTHETIC_DEMO_ONLY APP_DB_HOST_POSTGRES=127.0.0.1
APP_DB_PORT_POSTGRES=55432 APP_DB_NAME_POSTGRES=<base> APP_DB_USER_POSTGRES=noshow_app_runtime
APP_DB_PASS_POSTGRES=… PORT=3001 npm run dev` (con Python v2 en `127.0.0.1:8001`).
2. Abrir `http://127.0.0.1:3001/docs`, seleccionar `InternalApiKey` y pegar la clave en claro.
3. `POST /api/v1/reservations/900000000101002/predictions` `{"mode":"compare"}` (RF y XGB HIGH).
4. `GET …/900000000101002/overbooking-authorization` ⇒ copiar `modelKey` y `predictionRunId` de un
   candidato elegible ⇒ `POST …/overbooking-authorizations`.
5. `GET /api/v1/overbooking-authorizations?from=2026-11-01&to=2026-11-30`.
6. HU-07 requiere que la cita sintética (17/11/2026 15:00 Lima) haya terminado según el reloj del
   servidor; antes de esa fecha la API responde `409 APPOINTMENT_NOT_FINISHED` (comportamiento
   correcto). El flujo completo con reloj controlado está automatizado en
   `tests/integration/e2e/Sprint02DatabaseFlow.test.ts` y `tests/e2e/OperationalOptimization/Sprint02OperationalFlow.test.ts`.
7. HU-08: `POST …/900000000101002/space-recovery-outcomes` `{"spaceRecovered": false}`; probar el
   rechazo con `"false"` (400) y con una reserva sin marca (409).

Reservas sintéticas útiles: `900000000101002` (RF HIGH, XGB HIGH), `900000000101003` (RF MEDIUM,
XGB HIGH), `900000000101001` (LOW/LOW), `900000000101007` (cancelada).
