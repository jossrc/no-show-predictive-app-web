# ADR-004 · `riskLevel = null` mientras la política esté pendiente

- **Contexto:** FastAPI devuelve `risk_level=null`, `risk_policy_status=pending_validation`,
  `operational_use_allowed=false`; no hay umbrales ni calibración aprobados.
- **Decisión:** `RiskLevelPolicy` abstrae una política versionada; el runtime solo registra
  `PendingValidationRiskLevelPolicy` (nunca clasifica). No existe variable de entorno para umbrales.
  Filtros/orden por nivel ⇒ 409 `RISK_POLICY_UNAVAILABLE`. La BD impide `risk_level` sin versión
  ni aprobación y `operational_use_allowed=true`. `FakeRiskPolicy` vive solo en `tests/`.
- **Consecuencias:** el orden por probabilidad está disponible como **exploratorio**; el semáforo
  real requiere un release científico (nueva política + migración).
