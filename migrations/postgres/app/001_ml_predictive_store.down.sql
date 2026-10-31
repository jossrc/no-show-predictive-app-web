-- TESIS 2026-2027 · Sprint 01 · Migración app 001 (DOWN)
-- SOLO para bases de prueba aisladas (el runner lo exige). Elimina únicamente objetos creados
-- por 001.up. El schema ml se conserva (es preexistente). Nunca toca raw_flow ni analytics.
DROP TABLE IF EXISTS ml.prediction_model_results;
DROP TABLE IF EXISTS ml.prediction_runs;
DROP TABLE IF EXISTS ml.booking_feature_snapshots;
DROP FUNCTION IF EXISTS ml.prevent_mutation();
