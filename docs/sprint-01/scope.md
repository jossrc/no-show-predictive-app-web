# Sprint 01 — Alcance (backend)

> Fuente: `PROMPTS/PROMPT_CLAUDE_BACKEND_FASTIFY_SPRINT_01.md` (especificación del propietario, 10-10-2026).
> El documento PI1 v4 (`.docx`) **no estaba en el checkout**: el alcance se tomó del resumen
> explícito de HU incluido en ese prompt y de `../diagramas/backlog-historias-usuario-sprints.md`.
> No se afirma haber abierto el DOCX.

## Historias activas implementadas en este sprint

| HU    | Historia                               | Qué entrega el backend                                                                                                                                               | Estado (ver `acceptance_matrix.md`)                                            |
| ----- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| HU-01 | Citas programadas por nivel de riesgo  | `GET /api/v1/reservations` paginado (keyset) con scores persistidos, `riskLevel=null`, `classificationUnavailable=true`                                              | Parcial: semáforo pendiente de validación científica                           |
| HU-02 | Porcentaje estimado de inasistencia    | `GET …/risk` (lectura) y `POST …/predictions` (acción explícita, idempotente) con RF/XGB, `probabilityNoShow` ∈ [0,1] y `percentageNoShow = 100·p`                   | Implementado y probado; en datos reales bloqueado por evidencia (NOT_SCORABLE) |
| HU-03 | Filtrado y priorización                | Filtros período/sede/estado/modelo; orden cronológico u **exploratorio** por probabilidad (NULLS LAST); `riskLevel`/`sort=riskLevel` ⇒ 409 `RISK_POLICY_UNAVAILABLE` | Parcial: filtros por nivel solo con política aprobada                          |
| HU-05 | Factores asociados a la predicción     | `GET …/risk/factors` (SHAP local bajo demanda, mismas 19 features del snapshot, sin causalidad)                                                                      | Implementado y probado (sintético/real Python)                                 |
| HU-06 | Historial de inasistencias del cliente | `GET …/client-history` con corte `booking_creation` (as-of) o `current_known`                                                                                        | Implementado y probado                                                         |

## Retiradas por el propietario (no implementadas)

HU-04 (recálculo dinámico), HU-07 (vista de anticipación; `booking_lead_days` **se conserva** como
predictora), HU-09, HU-14, HU-16, HU-19, HU-20.

## Activas de sprints posteriores (sin cambios)

HU-08, HU-10, HU-11 (Sprint 02); HU-12, HU-13, HU-15 (Sprint 03); HU-17, HU-18, HU-21, HU-22
(Sprint 04). No se crearon endpoints, tablas, jobs ni menús para ellas. Sin login, usuarios,
roles, campañas, importadores CSV/Excel ni reportes.

## Decisiones de alcance

- Seguridad **transversal mínima**: compuerta de credencial interna (no es HU-21/HU-22). Ver ADR-003.
- `riskLevel` siempre `null` mientras la política de niveles esté `pending_validation`. Ver ADR-004.
- Fuente de snapshots: la réplica actual no demuestra la foto de reserva ⇒ `NOT_SCORABLE`. Ver ADR-005.
- `GET /api/v1/ml/models` y `GET /api/v1/health/ml` son endpoints de soporte (identidad de modelos y disponibilidad).
- `PredictionClient.batch` existe y está probado (integridad de índices), pero **no** tiene endpoint público (HU-15 es Sprint 03).
