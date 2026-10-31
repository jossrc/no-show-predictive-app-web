# ADR-002 · SQL parametrizado sobre Sequelize y almacén `ml` inmutable

- **Contexto:** consultas de lectura sobre esquemas heredados con nombres en comillas, keyset con
  `NULLS LAST`, `LATERAL`, `ON CONFLICT` e idempotencia concurrente.
- **Decisión:** repositorios con SQL explícito parametrizado (`bind`), whitelists fijas de
  columnas/orden, transacciones `REPEATABLE READ READ ONLY` con `statement_timeout` y `jit=off`
  locales para lecturas; escrituras solo en `ml` con UNIQUE, CHECK y triggers anti-UPDATE.
  Migraciones versionadas propias (`npm run migrate:app`, checksum, `--dry-run`, `down` solo en BD desechable).
- **Alternativas descartadas:** modelos `sequelize-typescript` con `upsert` (semántica opaca para
  ON CONFLICT selectivo), Prisma/Drizzle (cambio de ORM injustificado), `sync({alter})` (prohibido).
- **Consecuencias:** SQL revisable y medible (EXPLAIN en `performance.md`); sin cambios en tablas reales.
