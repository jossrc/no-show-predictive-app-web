import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapMlHttpError } from '../../../../../src/infrastructure/http/ml/MlHttpErrorMapper.js';
import { MlContractViolationException } from '../../../../../src/infrastructure/http/ml/errors/MlContractViolationException.js';
import { MlExplanationUnavailableException } from '../../../../../src/infrastructure/http/ml/errors/MlExplanationUnavailableException.js';
import { MlFeatureVersionMismatchException } from '../../../../../src/infrastructure/http/ml/errors/MlFeatureVersionMismatchException.js';
import { MlInvalidFeaturesException } from '../../../../../src/infrastructure/http/ml/errors/MlInvalidFeaturesException.js';
import { MlRateLimitedException } from '../../../../../src/infrastructure/http/ml/errors/MlRateLimitedException.js';
import { MlUnavailableException } from '../../../../../src/infrastructure/http/ml/errors/MlUnavailableException.js';
import { loadMlGolden } from '../../../../helpers/LoadFixture.js';

const envelope = (code: string, details: Array<{ field: string; reason: string }> = []) => ({
  error: { code, message: 'x', details },
  request_id: 'r',
});

describe('MlHttpErrorMapper (códigos Python → excepciones estables Node)', () => {
  it('401 ⇒ ML_CREDENTIAL_REJECTED sin revelar la clave', () => {
    const error = mapMlHttpError(401, loadMlGolden('golden_error_401'), 'predict');
    assert.ok(error instanceof MlUnavailableException);
    assert.equal((error as MlUnavailableException).code, 'ML_CREDENTIAL_REJECTED');
    assert.doesNotMatch(JSON.stringify(error), /api-key|x-service/i);
  });

  it('404 UNKNOWN_MODEL ≠ reserva inexistente; 404 de ruta ⇒ contrato roto', () => {
    const unknownModel = mapMlHttpError(
      404,
      envelope('UNKNOWN_MODEL'),
      'predict',
    ) as MlUnavailableException;
    assert.equal(unknownModel.code, 'ML_MODEL_UNAVAILABLE');
    assert.ok(
      mapMlHttpError(404, envelope('NOT_FOUND'), 'predict') instanceof MlContractViolationException,
    );
  });

  it('409, 413, 422, 429, 400 tienen tratamiento propio', () => {
    assert.ok(
      mapMlHttpError(409, envelope('FEATURE_VERSION_MISMATCH'), 'predict') instanceof
        MlFeatureVersionMismatchException,
    );
    assert.equal(
      (mapMlHttpError(413, null, 'batch') as MlContractViolationException).code,
      'ML_PAYLOAD_TOO_LARGE',
    );
    assert.equal(
      (mapMlHttpError(400, null, 'predict') as MlContractViolationException).code,
      'ML_REQUEST_REJECTED',
    );
    assert.ok(
      mapMlHttpError(429, envelope('RATE_LIMITED'), 'predict') instanceof MlRateLimitedException,
    );

    const invalid = mapMlHttpError(
      422,
      envelope('INVALID_FEATURES', [
        { field: 'features.booking_lead_days', reason: 'greater_than' },
        { field: 'features.<script>', reason: 'x y' },
      ]),
      'predict',
    ) as MlInvalidFeaturesException;
    assert.ok(invalid instanceof MlInvalidFeaturesException);
    assert.deepEqual(invalid.details, {
      issues: [{ field: 'features.booking_lead_days', reason: 'greater_than' }],
      source: 'ML_SERVICE',
    });
  });

  it('SHAP 503/500 ⇒ EXPLANATION_UNAVAILABLE; inferencia 500/503 ⇒ ML no disponible', () => {
    assert.ok(
      mapMlHttpError(503, envelope('EXPLANATION_NOT_READY'), 'explain') instanceof
        MlExplanationUnavailableException,
    );
    assert.ok(
      mapMlHttpError(500, envelope('EXPLANATION_FAILED'), 'explain') instanceof
        MlExplanationUnavailableException,
    );
    assert.equal(
      (mapMlHttpError(500, envelope('INFERENCE_FAILED'), 'explain') as MlUnavailableException).code,
      'ML_INFERENCE_FAILED',
    );
    assert.equal(
      (mapMlHttpError(503, envelope('MODEL_NOT_READY'), 'compare') as MlUnavailableException).code,
      'ML_UNAVAILABLE',
    );
    assert.equal(
      (mapMlHttpError(502, 'html', 'compare') as MlUnavailableException).code,
      'ML_UNAVAILABLE',
    );
  });
});
