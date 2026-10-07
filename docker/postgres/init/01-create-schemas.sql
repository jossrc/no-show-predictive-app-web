-- Capa central: una sola base, responsabilidades por schema.
-- raw_flow  = lo que FLOWww almacena
-- analytics = lo que el proyecto interpreta y deriva
-- ml        = lo que los modelos consumen/producen

CREATE SCHEMA IF NOT EXISTS raw_flow;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS ml;

COMMENT ON SCHEMA raw_flow IS 'Copia controlada de FLOWww';
COMMENT ON SCHEMA analytics IS 'Reglas de negocio, outcomes y features';
COMMENT ON SCHEMA ml IS 'Modelos, snapshots y predicciones';
