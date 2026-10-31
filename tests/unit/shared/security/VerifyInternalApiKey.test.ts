import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isValidInternalApiKey,
  sha256Hex,
} from '../../../../src/shared/security/VerifyInternalApiKey.js';

const key = 'k'.repeat(40);

describe('VerifyInternalApiKey (hash SHA-256 + tiempo constante)', () => {
  it('valida solo la credencial cuyo hash está configurado', () => {
    assert.equal(isValidInternalApiKey(key, sha256Hex(key)), true);
    assert.equal(isValidInternalApiKey(`${key}x`, sha256Hex(key)), false);
  });

  it('rechaza ausente, corta (<32) o desmesurada (>512) sin comparar', () => {
    assert.equal(isValidInternalApiKey(undefined, sha256Hex(key)), false);
    const short = 's'.repeat(31);
    assert.equal(isValidInternalApiKey(short, sha256Hex(short)), false);
    const long = 'l'.repeat(513);
    assert.equal(isValidInternalApiKey(long, sha256Hex(long)), false);
  });
});
