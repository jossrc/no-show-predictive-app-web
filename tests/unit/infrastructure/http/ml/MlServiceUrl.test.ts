import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseAllowedHosts,
  resolveMlServiceBaseUrl,
} from '../../../../../src/infrastructure/http/ml/MlServiceUrl.js';

const dev = { nodeEnv: 'development' as const, allowedHosts: [] };

describe('MlServiceUrl (URL fija validada, anti-SSRF)', () => {
  it('acepta loopback en desarrollo', () => {
    assert.equal(resolveMlServiceBaseUrl('http://127.0.0.1:8001', dev).host, '127.0.0.1:8001');
    assert.equal(resolveMlServiceBaseUrl('http://localhost:8001/', dev).hostname, 'localhost');
  });

  it('rechaza hosts no permitidos, credenciales, rutas, query, esquemas raros y http en production', () => {
    for (const raw of [
      'http://169.254.169.254',
      'http://user:pass@127.0.0.1:8001',
      'http://127.0.0.1:8001/internal',
      'http://127.0.0.1:8001?x=1',
      'file:///etc/passwd',
      'no-url',
    ]) {
      assert.throws(() => resolveMlServiceBaseUrl(raw, dev), Error, raw);
    }
    assert.throws(() =>
      resolveMlServiceBaseUrl('http://127.0.0.1:8001', { ...dev, nodeEnv: 'production' }),
    );
  });

  it('allowlist explícita para redes internas', () => {
    const hosts = parseAllowedHosts(' ml-api , bad host ,ML.internal ');
    assert.deepEqual(hosts, ['ml-api', 'ml.internal']);
    assert.equal(
      resolveMlServiceBaseUrl('http://ml-api:8001', { ...dev, allowedHosts: hosts }).hostname,
      'ml-api',
    );
  });
});
