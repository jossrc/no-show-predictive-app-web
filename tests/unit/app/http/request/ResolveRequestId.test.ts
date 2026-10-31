import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { describe, it } from 'node:test';
import { resolveRequestId } from '../../../../../src/app/http/request/ResolveRequestId.js';

const withHeader = (value: unknown) =>
  ({ headers: { 'x-request-id': value } }) as unknown as IncomingMessage;

describe('ResolveRequestId', () => {
  it('reutiliza un X-Request-ID opaco válido (1-64, inicial alfanumérica)', () => {
    assert.equal(resolveRequestId(withHeader('next-req_01.a')), 'next-req_01.a');
  });

  it('genera UUID ante valores inválidos, largos, duplicados o con caracteres peligrosos', () => {
    for (const value of ['-x', 'a'.repeat(65), 'a b', 'id\nforged', ['a', 'b'], undefined, '']) {
      const id = resolveRequestId(withHeader(value));
      assert.match(id, /^[0-9a-f-]{36}$/, String(value));
    }
  });
});
