import { MlErrorEnvelopeSchema } from './MlContractSchemas.js';
import { MlContractViolationException } from './errors/MlContractViolationException.js';
import { MlExplanationUnavailableException } from './errors/MlExplanationUnavailableException.js';
import { MlFeatureVersionMismatchException } from './errors/MlFeatureVersionMismatchException.js';
import {
  MlInvalidFeaturesException,
  type SafeFieldIssue,
} from './errors/MlInvalidFeaturesException.js';
import { MlRateLimitedException } from './errors/MlRateLimitedException.js';
import { MlUnavailableException } from './errors/MlUnavailableException.js';

export type MlOperation = 'models' | 'ready' | 'predict' | 'compare' | 'explain' | 'batch';

const SAFE_FIELD = /^[A-Za-z0-9_.[\]]{1,120}$/;
const SAFE_REASON = /^[a-z_]{1,60}$/;

function readUpstreamError(body: unknown): { code: string; issues: SafeFieldIssue[] } {
  const parsed = MlErrorEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    return { code: 'UNPARSEABLE_ERROR', issues: [] };
  }

  const issues = parsed.data.error.details
    .filter((detail) => SAFE_FIELD.test(detail.field) && SAFE_REASON.test(detail.reason))
    .map((detail) => ({ field: detail.field, reason: detail.reason }));

  return { code: parsed.data.error.code, issues };
}

/**
 * Traduce estados HTTP del servicio Python a excepciones estables de Node. Un 404
 * UNKNOWN_MODEL es configuración incorrecta, no «reserva inexistente».
 */
export function mapMlHttpError(status: number, body: unknown, operation: MlOperation): Error {
  const upstream = readUpstreamError(body);

  switch (status) {
    case 400:
      return new MlContractViolationException({
        operation,
        code: 'ML_REQUEST_REJECTED',
        httpStatus: status,
      });
    case 401:
      return new MlUnavailableException({
        code: 'ML_CREDENTIAL_REJECTED',
        operation,
        httpStatus: status,
      });
    case 404:
      return upstream.code === 'UNKNOWN_MODEL'
        ? new MlUnavailableException({
            code: 'ML_MODEL_UNAVAILABLE',
            operation,
            httpStatus: status,
          })
        : new MlContractViolationException({ operation, httpStatus: status });
    case 409:
      return new MlFeatureVersionMismatchException({ operation });
    case 413:
      return new MlContractViolationException({
        operation,
        code: 'ML_PAYLOAD_TOO_LARGE',
        httpStatus: status,
      });
    case 422:
      return new MlInvalidFeaturesException({ operation, issues: upstream.issues });
    case 429:
      return new MlRateLimitedException({ operation, origin: 'ML_SERVICE' });
    case 500:
      return operation === 'explain' && upstream.code === 'EXPLANATION_FAILED'
        ? new MlExplanationUnavailableException({ upstreamCode: upstream.code, httpStatus: status })
        : new MlUnavailableException({
            code: 'ML_INFERENCE_FAILED',
            operation,
            httpStatus: status,
          });
    case 503:
      return operation === 'explain' && upstream.code === 'EXPLANATION_NOT_READY'
        ? new MlExplanationUnavailableException({ upstreamCode: upstream.code, httpStatus: status })
        : new MlUnavailableException({ code: 'ML_UNAVAILABLE', operation, httpStatus: status });
    default:
      return new MlUnavailableException({ code: 'ML_UNAVAILABLE', operation, httpStatus: status });
  }
}

/** 5xx y estados desconocidos degradan el circuito; 4xx de contrato no. */
export function isServerSideFailure(status: number): boolean {
  return status >= 500 || ![400, 401, 404, 409, 413, 422, 429].includes(status);
}
