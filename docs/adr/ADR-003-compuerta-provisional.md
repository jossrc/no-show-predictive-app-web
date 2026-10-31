# ADR-003 · Compuerta provisional de credencial interna (no es HU-21/HU-22)

- **Contexto:** los endpoints exponen reservas e historial; login y roles son Sprint 04.
- **Decisión:** las rutas `/api/v1` de negocio exigen `x-api-key`; el servidor guarda solo el
  SHA-256 (`INTERNAL_API_KEY_SHA256`) y compara en tiempo constante en `onRequest` (401 uniforme
  antes de validar). Sin hash, las rutas no se registran. En `production` el arranque se rechaza
  (`AUTH_FULL_FLOW_PENDING_HU21_HU22`). `RequestPrincipal` (sin `userId`) y `ClinicAccessScope`
  dejan el punto de extensión para RBAC. Sin CORS: el consumidor debe ser un servidor.
- **No hace:** usuarios, contraseñas, JWT, roles, recuperación de acceso.
- **Consecuencias:** la clave nunca debe llegar al navegador; HU-21/HU-22 reemplazarán la compuerta.
