# ADR-008 · PostgreSQL como único almacén predictivo (sustituye la decisión SQLite de ADR-006)

- **Estado:** aceptada (Sprint 02, 30/10/2026). **Sustituye** el punto 2 de
  [ADR-006](ADR-006-postgresql-solo-lectura-y-almacen-sqlite.md) (almacén local SQLite). Se
  **mantienen** sus puntos 1, 3 y 4: la fuente FLOWww (`raw_flow`/`analytics`) sigue siendo de SOLO
  LECTURA con el mismo guard. ADR-006 se conserva sin cambios como registro histórico.
- **Contexto:** el propietario decidió que PostgreSQL sea la **única** base de datos operativa del
  proyecto. En Sprint 01 el runtime persistía snapshots, runs y scores (research v2) en SQLite
  (`node:sqlite`, `.local/predictive-store/<modo>.sqlite`). El propietario autorizó **crear tablas
  nuevas** (índices y restricciones propias) e **insertar** en ellas; prohibió borrar, truncar,
  alterar o reemplazar objetos/filas existentes, ejecutar `down` y escribir en las tablas fuente.
  La inspección de catálogo (solo `SELECT`) de la base real mostró: `ml` existe y está **vacío**;
  `raw_flow` (13 tablas) y `analytics` (9 objetos) con datos; un único rol (`admin`, superusuario).
  El adaptador heredado `ml.*` (migración 001) solo admite scores v1 y su runner permite `down`.
- **Decisión:**
  1. **Dos conexiones al mismo motor.** `postgresSequelize` (fuente, solo lectura, intacta) y
     `PredictiveAppDatabase` (pool `pg` nuevo, variables `APP_DB_*`), con un rol **runtime**
     restringido: `USAGE` en `ml`, `SELECT/INSERT` en `ml.app_*`, `USAGE` de secuencias. Guard de
     sentencias propio (`PredictiveAppSqlGuard`): solo `SELECT`/`WITH`/`INSERT` en `ml.app_*` y control
     de transacción; bloquea `UPDATE`, `DELETE`, DDL, `ON CONFLICT DO UPDATE`, `raw_flow`/`analytics`.
  2. **Tablas NUEVAS `ml.app_*`** (prefijo propio, sin colisión con `ml.*` heredado): snapshots, runs
     y resultados con el contrato research v2 completo + tablas HU-06/07/08. Inmutables por triggers
     (`UPDATE`/`DELETE`/`TRUNCATE` ⇒ error, incluso para superusuario), FK compuestas que impiden
     vincular registros de otra reserva, UNIQUE de idempotencia e índices propios.
  3. **Migraciones solo `up`** en `migrations/postgres/predictive_app/` con runner restringido
     (`PredictiveAppMigrationRunner`): rechaza vocabulario destructivo antes de conectar
     (`AdditiveMigrationGuard`), preflight de colisiones (sin `IF NOT EXISTS`), checksum, `lock_timeout`
     corto, una transacción por migración, verificación posterior e historial en una tabla nueva
     (`ml.app_predictive_store_migrations`; no toca `ml.app_schema_migrations`). Las ejecuta un rol
     **migrador** separado (`npm run store:migrate`, `PREDICTIVE_STORE_MIGRATION_AUTHORIZED=true`).
  4. **Identidad de modo**: `ml.app_predictive_store_identity` liga cada base a un `DATA_SOURCE_MODE`;
     real y sintético nunca comparten base.
  5. **Arranque fail-closed**: base distinta, rol privilegiado (salvo `APP_DB_ALLOW_PRIVILEGED_ROLE`
     en desarrollo; prohibido en production), esquema no migrado, modo no ligado o distinto ⇒
     `PERSISTENCE_UNAVAILABLE` y el proceso no arranca. Sin fallback a SQLite ni a memoria.
  6. **Histórico SQLite**: se respalda (copia + SHA-256) y se importa con una utilidad puntual
     (`npm run store:import-legacy`, `PREDICTIVE_STORE_IMPORT_AUTHORIZED=true`) que lee una COPIA
     temporal en solo lectura, inserta en una transacción en orden FK, es idempotente y reconcilia
     conteos, hashes de snapshot y contenido exacto de cada score. Es el ÚNICO archivo que importa
     `node:sqlite`; los archivos de origen nunca se modifican ni se borran.
- **Consecuencias:** el código SQLite de runtime se retiró del control de versiones (queda en el
  historial git); las pruebas de persistencia usan bases PostgreSQL de prueba desechables (una por
  suite) en el contenedor `docker-compose.test.yml`, con los roles reales de `roles.sql`. Como la
  base real solo tiene un superusuario, el aprovisionamiento de roles, la migración y la importación
  sobre ella requieren autorización explícita del propietario (ver
  `docs/sprint-02/postgresql-only-migration.md`).
- **Alternativas descartadas:** seguir con SQLite (contraria a la decisión del propietario); activar
  el adaptador `ml.*` heredado (solo v1, `down` destructivo); `ALTER` de las tablas `ml.*` heredadas
  (prohibido); usar el superusuario como rol runtime (privilegios excesivos);
  `sequelize.sync()` (no verificable, puede alterar esquemas).
