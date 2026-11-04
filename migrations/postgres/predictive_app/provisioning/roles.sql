-- TESIS 2026-2027 · Sprint 02 · Aprovisionamiento de roles del almacén predictivo (ADR-008)
-- Ejecución MANUAL por el propietario/DBA de la base (psql), UNA vez por base. No lo invoca la app
-- ni `npm run store:migrate`. Solo crea roles y concede privilegios mínimos: no toca datos, no
-- altera tablas existentes y no concede nada sobre raw_flow ni analytics.
--
--   psql -v ON_ERROR_STOP=1 \
--        -v migrator_password="'<secreto-migrador>'" -v runtime_password="'<secreto-runtime>'" \
--        -d <base> -f migrations/postgres/predictive_app/provisioning/roles.sql
--
-- Roles:
--   noshow_app_migrator  LOGIN · crea objetos ml.app_* (store:migrate). Sin superusuario.
--   noshow_app_runtime   LOGIN · proceso Fastify: SELECT/INSERT sobre ml.app_* y USAGE de sus
--                        secuencias. Sin CREATE, UPDATE, DELETE ni TRUNCATE.

CREATE ROLE noshow_app_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
    PASSWORD :migrator_password;
CREATE ROLE noshow_app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
    PASSWORD :runtime_password;

GRANT CONNECT ON DATABASE :"DBNAME" TO noshow_app_migrator, noshow_app_runtime;
GRANT USAGE, CREATE ON SCHEMA ml TO noshow_app_migrator;
GRANT USAGE ON SCHEMA ml TO noshow_app_runtime;

-- Objetos que el migrador cree a partir de ahora: el runtime solo lee e inserta.
ALTER DEFAULT PRIVILEGES FOR ROLE noshow_app_migrator IN SCHEMA ml
    GRANT SELECT, INSERT ON TABLES TO noshow_app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE noshow_app_migrator IN SCHEMA ml
    GRANT USAGE ON SEQUENCES TO noshow_app_runtime;
