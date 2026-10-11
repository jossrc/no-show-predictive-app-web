# ADR-001 · PostgreSQL como almacén predictivo y tests fuera de `src/`

- **Estado:** aceptada (Sprint 01, 10-10-2026)
- **Contexto:** la guía de arquitectura ejemplifica MariaDB/Sequelize y tests co-localizados; este
  backend ya opera sobre PostgreSQL poblado (`raw_flow`, `analytics`) y el propietario exige tests en `tests/`.
- **Decisión:** usar PostgreSQL y el schema existente `ml` para lo propio; conservar Sequelize como
  cliente (SQL parametrizado vía `sequelize.query`, sin `sync`). Todos los tests en `tests/**`
  reflejando módulos/features; `tsconfig.json` no los emite y `tsconfig.test.json` los tipa.
- **Consecuencias:** se preservan Screaming Architecture, Vertical Slices, Request/Input/Result/Response,
  handlers delgados y composition roots. El test de arquitectura impide tests en `src/`.
