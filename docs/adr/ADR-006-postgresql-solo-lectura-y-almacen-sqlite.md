# ADR-006 · PostgreSQL solo lectura y almacén predictivo local SQLite

- **Contexto:** la base PostgreSQL local (`depi-noshow-db`) es la réplica fuente de FLOWww. El único
  rol disponible es un superusuario y no está autorizado escribir en ella (ni migrar el schema `ml`,
  que existe vacío). El POST de predicción necesitaba persistir snapshots y scores en `ml.*`.
- **Decisión:**
  1. Conexión runtime **de solo lectura**: `options=-c default_transaction_read_only=on`,
     `REPEATABLE READ READ ONLY` + `statement_timeout` por lectura y `installReadOnlySqlGuard`, que
     envuelve `sequelize.query` y rechaza DML/DDL/GRANT/`FOR UPDATE`/CTE con DML/multi-sentencia/
     funciones con efectos antes de enviarlas (`SOURCE_WRITE_BLOCKED`). `migrate:app` (sin
     `--dry-run`) y `migrate:flow` exigen `ML_SCHEMA_WRITE_AUTHORIZED` / `FLOW_MIGRATION_WRITE_AUTHORIZED`.
  2. **Almacén local SQLite** (`node:sqlite`, Node ≥ 24; sin dependencia nativa) detrás de los puertos
     existentes `BookingSnapshotRepository`, `PredictionResultRepository` y del nuevo
     `ReservationScoreReader`. Archivo por modo de datos (`.local/predictive-store/<modo>.sqlite`,
     ignorado por Git, 0700/0600, ligado a su modo vía `store_meta`), WAL + `synchronous=FULL`,
     migraciones locales versionadas con checksum, `STRICT`, CHECKs (operativo=0, banda todo-o-nada,
     `risk_level` solo aprobado), triggers de inmutabilidad, UNIQUE por snapshot+modelo+versión+política.
     Transacciones `BEGIN IMMEDIATE` síncronas y cortas, nunca abiertas durante la llamada a Python.
  3. `ScoredReservationRepository` compone la **fuente** (SQL de solo lectura, sin `ml.*`) con el
     almacén local: el orden por score es un ranking GLOBAL en dos fases (ranking local → verificación
     de filtros de negocio en la fuente → cola cronológica NULLS LAST), sin N+1 y sin ordenar solo la
     página. Tope `MAX_RANKING_CANDIDATES=50 000` reservas puntuadas por modelo (por encima ⇒ 422).
  4. `SYNTHETIC_DEMO_ONLY` usa proveedores sintéticos versionados (reservas, evidencia, historial):
     ninguna lectura de negocio a PostgreSQL y archivo SQLite propio.
- **Alternativas descartadas:** migrar `ml` en la réplica (prohibido); JSON/Map en memoria (no
  durable); `better-sqlite3` (dependencia nativa innecesaria); conservar joins `ml.*` en el listado
  (falla sin migración y mezcla almacenes).
- **Futuro:** los adaptadores `Sequelize*Repository` del schema `ml` se conservan aislados (no
  conectados) y fallan cerrado ante scores v2; activarlos exigirá autorización expresa, una conexión
  de escritura separada y una migración 002 con las columnas research.
- **Consecuencias:** cero escrituras en PostgreSQL (verificado por contadores `pg_stat_user_tables`);
  el histórico predictivo vive en un archivo local que hay que respaldar (`npm run store:backup`).
