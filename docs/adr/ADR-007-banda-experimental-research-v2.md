# ADR-007 · Banda experimental research v2 separada del riesgo operativo

- **Contexto:** Python publica `research_risk_v1_1` (`GET /internal/v2/risk-policy`): una política
  por modelo con terciles relativos del score crudo (RF 0.302192334412/0.460052607619, XGB
  0.243454828858/0.435159325600), `RESEARCH_PROVISIONAL`, `approved_by=null`. ADR-004 mantiene
  `riskLevel=null` mientras no exista política aprobada.
- **Decisión:**
  - Cliente v2 tipado (`getResearchPolicy`, `predictResearch`, `compareResearch`) junto a v1 (explain y
    batch siguen en v1). Zod estricto + verificaciones de integridad: identidad del artefacto,
    `percent=100·p`, límites `0<low<high<1`, etiqueta/nivel coherentes con la regla publicada (solo
    como verificación), política distinta por modelo, y cruce exacto con el catálogo (id, versión,
    hash, límites, regla, SHA-256 del modelo). Una discrepancia ⇒ 502 y nada persistido.
  - Node **no** guarda umbrales propios ni clasifica: copia `experimental_risk` tal cual en un campo
    nuevo `experimentalRisk`, separado de `riskLevel` (que sigue `null`). Nunca se combina RF y XGB.
  - Con `ML_RESEARCH_RISK_ENABLED=true` la banda es obligatoria: política no disponible ⇒ `503
RESEARCH_RISK_POLICY_NOT_READY` (sin fallback a v1, sin `LOW`); el 503 no abre el circuito de v1.
  - Idempotencia por (snapshot, modelo, versión, hash de política): un cambio de política genera un
    score nuevo; nunca se reinterpreta un score antiguo.
  - Listado: `experimentalRiskLevel` y `sort=experimentalRisk` sobre la política vigente (la del score
    v2 más reciente del modelo), firmada en el cursor; reservas con otra política o v1 quedan sin
    clasificar (cola NULLS LAST). `riskLevel`/`sort=riskLevel` siguen en 409.
- **Consecuencias:** semáforo experimental funcional y trazable sin falsear estados:
  `operationalUseAllowed=false`, `approvedBy=null`, `classificationBasis=RESEARCH_PROVISIONAL`.
