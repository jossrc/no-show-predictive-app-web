# Sprint 03 · Registro de excepción: checksum distinto en la migración 001 del almacén predictivo

- **Fecha:** 27/11/2026. **Autorización:** propietario de la base (autorización explícita en sesión).
- **Alcance:** `migrations/postgres/predictive_app/001_app_predictive_store.sql` y aplicación de la
  migración 003 en `depi-noshow-db`. Marco: [ADR-008](../adr/ADR-008-postgresql-unico-almacen-predictivo.md)
  (migraciones solo `up`, checksum inmutable).

## Síntomas

| Comando                              | Resultado                                                     |
| ------------------------------------ | ------------------------------------------------------------- |
| `npm run dev`                        | `PERSISTENCE_UNAVAILABLE: SCHEMA_VERSION_MISMATCH`            |
| `npm run store:migrate -- --dry-run` | `Checksum distinto en la migración 001` (bloquea aplicar 003) |

Son dos causas independientes: el arranque exige `max(version) = '003'` y la base estaba en `002`
(se resuelve aplicando 003); el checksum impedía aplicar 003.

## Causa

La migración 001 se aplicó el 31/10/2026 04:19:56Z con checksum
`09b844b486fde171da5c07b3f158504812af57ce064937a5cbc30e32d1d18840`. Después, y antes del commit
`90dc600` (04/11/2026), se editó a mano su **primera línea de comentario**; git solo registró la
versión editada (checksum `d7e1bf04fc01acfc753af111dcf260d52e5b32dea855f17da48e48e815bd020e`):

```diff
--- TESIS 2026-2027 · Sprint 02 · Almacén predictivo PostgreSQL (migración 001, SOLO up)
+-- Sprint 02 · Almacén predictivo PostgreSQL (migración 001, SOLO up)
```

## Recuperación del original

El archivo aplicado se recuperó del historial local de archivos de Claude Code de la sesión de
Sprint 02 (`~/.claude/file-history/6fc8dfe1-…/564cd4860469bcf9@v2`, guardado 04:18:28Z, 88 s antes
de aplicarse). Su SHA-256 coincide exactamente con el registrado; la copia del mismo origen de la
002 coincide también con su checksum. Copia de evidencia en
`.local/migration-audit-20261127/` (con `SHA256SUMS.txt`).

## Evidencia de equivalencia estructural

En un PostgreSQL 18.4 efímero y aislado (tmpfs, solo loopback) se aplicaron 001+002 con el runner
real, con la 001 actual y con la original:

- `pg_dump --schema-only -n ml`: ambas variantes idénticas byte a byte; frente a la base operativa
  solo difiere `COMMENT ON SCHEMA ml` (creado por `docker/postgres/init/01-create-schemas.sql`,
  ajeno a las migraciones).
- Huella de catálogos (505 filas: tablas, columnas, tipos, defaults, NOT NULL, PK/FK/UNIQUE/CHECK,
  índices, triggers, función `ml.app_prevent_mutation`, secuencias, ACL, owners, RLS): idéntica
  salvo el mismo comentario de schema.
- Sobre una réplica del catálogo operativo: con la 001 actual se reproduce el error; con la 001
  original queda pendiente solo 003, que se aplica de forma estrictamente aditiva (+217 filas de
  catálogo, 0 modificadas/eliminadas).

Conclusión: la diferencia es **meramente descriptiva** (comentario SQL `--`, no persistido en el
catálogo); no hay diferencia funcional.

## Corrección aplicada

1. Respaldo completo verificado por restauración en contenedor aislado (ver «Ejecución y verificación»).
2. Se **restauraron los bytes originales** de la 001 en el repositorio (no se tocó la base, no se
   cambió ningún checksum almacenado, no se relajó el runner).
3. Se añadió `tests/unit/infrastructure/database/PredictiveAppMigrationChecksums.test.ts`, que fija
   los checksums de las migraciones aplicadas para detectar en `npm test` cualquier edición futura.
4. Se aplicó la migración 003 con `store:migrate` (autorizado).

## Ejecución y verificación (28/11/2026 UTC)

| Paso                     | Evidencia                                                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Respaldo previo          | `.local/db-backups/depi-noshow-db-full-pre-003-20261128T032214Z.dump` (+ `.globals.sql` sin hashes de contraseña, `.sha256`). Restaurado con `--single-transaction` en contenedor aislado sin red: conteos y huellas md5 de las 30 tablas y catálogo `ml` idénticos a la operativa |
| Dry-run tras restaurar   | `applied: [001, 002]`, `pending: [003_app_reservation_import_and_retention]`                                                                                                                                                                                                    |
| `store:migrate`          | `applied: ["003"]` (2026-11-28 03:26:09Z), `identity: ALREADY_BOUND` (`READ_ONLY_EXISTING_SCHEDULE`)                                                                                                                                                                            |
| Historial                | 001 `09b844b4…` y 002 `ad2b5cba…` sin cambios; 003 `beb1951e…`                                                                                                                                                                                                                  |
| Catálogo `ml` post-003   | idéntico al de la réplica probada en el entorno aislado                                                                                                                                                                                                                        |
| Datos                    | todas las tablas previas de `ml`, `raw_flow` y `analytics` con conteo y huella idénticos; solo cambian el historial (2→3 filas) y 4 tablas nuevas vacías                                                                                                                        |
| Arranque                 | `GET /api/v1/health/predictive-store` ⇒ `status: ok`, `schemaVersion: "003"`                                                                                                                                                                                                   |

Alternativas descartadas: actualizar el checksum almacenado (destruye la evidencia histórica);
override/lista de checksums aceptados en el runner (debilita la validación); normalizar comentarios
antes del hash (cambiaría retroactivamente el significado de todos los checksums).

## Regla derivada

Una migración registrada en `ml.app_predictive_store_migrations` no se edita, ni siquiera sus
comentarios. Cualquier aclaración va en la documentación o en una migración nueva.
