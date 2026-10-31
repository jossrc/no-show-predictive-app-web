const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export interface ResolveMlServiceUrlOptions {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly allowedHosts: readonly string[];
}

/**
 * Valida la URL fija del servicio ML (nunca proviene del usuario: evita SSRF).
 * Desarrollo/test: loopback o allowlist explícita. Producción: además exige https.
 */
export function resolveMlServiceBaseUrl(raw: string, options: ResolveMlServiceUrlOptions): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('ML_SERVICE_URL no es una URL válida');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('ML_SERVICE_URL debe usar http o https');
  }
  if (url.username || url.password) {
    throw new Error('ML_SERVICE_URL no debe contener credenciales');
  }
  if (url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('ML_SERVICE_URL debe ser una URL base sin ruta, query ni fragmento');
  }

  const host = url.hostname.toLowerCase();
  const allowed = LOOPBACK_HOSTS.has(host) || options.allowedHosts.includes(host);
  if (!allowed) {
    throw new Error('ML_SERVICE_URL apunta a un host no permitido (loopback o allowlist)');
  }
  if (options.nodeEnv === 'production' && url.protocol !== 'https:') {
    throw new Error('ML_SERVICE_URL debe usar https en production');
  }

  return url;
}

export function parseAllowedHosts(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => /^[a-z0-9.-]{1,253}$/.test(host));
}
