# ADR-005 · Fuente de snapshots booking_creation y NOT_SCORABLE

- **Contexto:** el modelo se entrenó con la foto al crear la reserva. La réplica `raw_flow`/`analytics`
  no guarda cuándo se creó cada línea de servicio, el catálogo no está versionado y los clientes se
  modifican (agregados en `source_inventory.md`).
- **Decisión:** `AssessBookingEvidence` exige evidencia temporal de cada componente; si falta,
  `NOT_SCORABLE` con motivos tipados (sin score 0, sin nulos inventados, sin Python). Solo se
  puntúan snapshots inmutables de `ml.booking_feature_snapshots` con evidencia
  `VERIFIED_BOOKING_SNAPSHOT` (real) o `SYNTHETIC_DEMO_ONLY` (solo BD de prueba, modos excluyentes).
- **Consecuencias:** hoy ninguna reserva real es puntuable; la demostración funcional usa datos
  sintéticos. Desbloquearlo exige una captura fechada al reservar (sincronizador/HU-15, fuera de
  Sprint 01). El builder reproduce exactamente el ETL de entrenamiento (prueba de paridad).

- **Actualización 2026-10-11:** los snapshots se persisten en el almacén SQLite local (ADR-006), no en
  `ml.booking_feature_snapshots`. Auditoría read-only del 2026-10-12: `raw_flow.diary_det` no tiene
  columnas temporales por línea; 0 de 8.887 reservas FUTURE con evidencia (ver `source_inventory.md`).
  `SYNTHETIC_DEMO_ONLY` usa proveedores sintéticos versionados en lugar de la BD de prueba.
