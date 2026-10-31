import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../src/app/http/security/RequirePrincipal.js';
import { UnauthorizedException } from '../../../../../src/shared/errors/security/UnauthorizedException.js';
import {
  canAccessClinic,
  PROVISIONAL_INTERNAL_PRINCIPAL,
} from '../../../../../src/shared/security/RequestPrincipal.js';

describe('RequirePrincipal y alcance de sedes (preparatorio HU-21/HU-22)', () => {
  it('falla cerrado si una ruta de negocio no pasó por la compuerta', () => {
    assert.throws(
      () => requirePrincipal({ principal: null } as FastifyRequest),
      UnauthorizedException,
    );
    assert.equal(
      requirePrincipal({ principal: PROVISIONAL_INTERNAL_PRINCIPAL } as FastifyRequest),
      PROVISIONAL_INTERNAL_PRINCIPAL,
    );
  });

  it('el principal provisional no tiene identidad de usuario y declara la limitación', () => {
    assert.equal(PROVISIONAL_INTERNAL_PRINCIPAL.userId, null);
    assert.equal(PROVISIONAL_INTERNAL_PRINCIPAL.limitation, 'AUTH_FULL_FLOW_PENDING_HU21_HU22');
    assert.equal(canAccessClinic({ kind: 'CLINICS', clinicIds: [3] }, 4), false);
    assert.equal(canAccessClinic({ kind: 'ALL_CLINICS' }, 4), true);
  });
});
