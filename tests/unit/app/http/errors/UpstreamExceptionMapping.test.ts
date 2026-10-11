import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildErrorResponse } from '../../../../../src/app/http/errors/BuildErrorResponse.js';
import { getHttpStatusFromException } from '../../../../../src/app/http/errors/GetHttpStatusFromException.js';
import { normalizeException } from '../../../../../src/app/http/errors/NormalizeException.js';
import { PersistenceUnavailableException } from '../../../../../src/infrastructure/database/errors/PersistenceUnavailableException.js';
import { MlContractViolationException } from '../../../../../src/infrastructure/http/ml/errors/MlContractViolationException.js';
import { MlExplanationUnavailableException } from '../../../../../src/infrastructure/http/ml/errors/MlExplanationUnavailableException.js';
import { MlFeatureVersionMismatchException } from '../../../../../src/infrastructure/http/ml/errors/MlFeatureVersionMismatchException.js';
import { MlRateLimitedException } from '../../../../../src/infrastructure/http/ml/errors/MlRateLimitedException.js';
import { MlTimeoutException } from '../../../../../src/infrastructure/http/ml/errors/MlTimeoutException.js';
import { MlUnavailableException } from '../../../../../src/infrastructure/http/ml/errors/MlUnavailableException.js';
import { NotScorableException } from '../../../../../src/modules/ReservationRisk/Shared/errors/NotScorableException.js';
import { RiskPolicyUnavailableException } from '../../../../../src/modules/ReservationRisk/Shared/errors/RiskPolicyUnavailableException.js';
import { notScorableReason } from '../../../../../src/modules/ReservationRisk/Shared/models/NotScorableReason.js';
import { ReservationNotFoundException } from '../../../../../src/modules/Reservations/Shared/errors/ReservationNotFoundException.js';

describe('Mapeo de excepciones Sprint 01 sobre el error handler existente', () => {
  const cases: Array<[Error, number, string]> = [
    [new ReservationNotFoundException(), 404, 'RESERVATION_NOT_FOUND'],
    [new RiskPolicyUnavailableException(), 409, 'RISK_POLICY_UNAVAILABLE'],
    [new NotScorableException([notScorableReason('MISSING_BOOKING_TIME')]), 409, 'NOT_SCORABLE'],
    [
      new MlFeatureVersionMismatchException({ operation: 'predict' }),
      409,
      'FEATURE_VERSION_MISMATCH',
    ],
    [
      new MlRateLimitedException({ operation: 'predict', origin: 'ML_SERVICE' }),
      429,
      'ML_RATE_LIMITED',
    ],
    [
      new MlUnavailableException({ code: 'ML_UNAVAILABLE', operation: 'predict' }),
      503,
      'ML_UNAVAILABLE',
    ],
    [
      new MlUnavailableException({ code: 'ML_CREDENTIAL_REJECTED', operation: 'predict' }),
      503,
      'ML_CREDENTIAL_REJECTED',
    ],
    [new MlTimeoutException({ operation: 'explain', timeoutMs: 10 }), 504, 'ML_TIMEOUT'],
    [new MlContractViolationException({ operation: 'compare' }), 502, 'ML_CONTRACT_VIOLATION'],
    [
      new MlExplanationUnavailableException({
        upstreamCode: 'EXPLANATION_NOT_READY',
        httpStatus: 503,
      }),
      503,
      'EXPLANATION_UNAVAILABLE',
    ],
    [new PersistenceUnavailableException({ operation: 'SaveRun' }), 503, 'PERSISTENCE_UNAVAILABLE'],
  ];

  for (const [error, status, code] of cases) {
    it(`${code} ⇒ HTTP ${status}`, () => {
      const normalized = normalizeException(error);
      assert.equal(getHttpStatusFromException(normalized), status);
      assert.equal(normalized.code, code);
    });
  }

  it('errores de infraestructura no exponen mensajes internos; NOT_SCORABLE expone motivos seguros', () => {
    const infra = buildErrorResponse(
      normalizeException(new MlTimeoutException({ operation: 'x', timeoutMs: 1 })),
      'r1',
    );
    assert.equal(infra.error.message, 'Un servicio dependiente excedió el tiempo permitido');
    assert.equal(infra.error.details, undefined);

    const business = buildErrorResponse(
      normalizeException(new NotScorableException([notScorableReason('MISSING_BOOKING_TIME')])),
      'r2',
    );
    assert.deepEqual(business.error.details, {
      reasons: [
        {
          code: 'MISSING_BOOKING_TIME',
          message: notScorableReason('MISSING_BOOKING_TIME').message,
        },
      ],
    });
  });
});
