import { CircuitBreaker } from '../../resilience/CircuitBreaker.js';
import {
  ConcurrencyLimitExceededError,
  ConcurrencyLimiter,
} from '../../resilience/ConcurrencyLimiter.js';
import type {
  MlBatchRequest,
  MlBatchResponse,
  MlCompareRequest,
  MlCompareResponse,
  MlExplanationRequest,
  MlExplanationResponse,
  MlModelsResponse,
  MlPredictionRequest,
  MlPredictionResponse,
  MlReadyResponse,
  MlResearchCompareRequest,
  MlResearchCompareResponse,
  MlResearchPolicyCatalog,
  MlResearchPredictionRequest,
  MlResearchPredictionResponse,
} from './MlContractTypes.js';
import {
  validateBatchResponse,
  validateCompareResponse,
  validateExplanationResponse,
  validateModelsResponse,
  validatePredictionResponse,
  validateReadyResponse,
} from './MlContractValidator.js';
import { toCanonicalFeatures } from './MlFeatureContract.js';
import {
  validateResearchCompareResponse,
  validateResearchPolicyCatalog,
  validateResearchPredictionResponse,
} from './MlResearchContractValidator.js';
import { isServerSideFailure, mapMlHttpError, type MlOperation } from './MlHttpErrorMapper.js';
import type { MlPredictionClient, MlRequestContext } from './MlPredictionClient.js';
import type { MlTimeoutPolicy } from './MlTimeoutPolicy.js';
import { MlContractViolationException } from './errors/MlContractViolationException.js';
import { MlRateLimitedException } from './errors/MlRateLimitedException.js';
import { MlResearchPolicyUnavailableException } from './errors/MlResearchPolicyUnavailableException.js';
import { MlTimeoutException } from './errors/MlTimeoutException.js';
import { MlUnavailableException } from './errors/MlUnavailableException.js';

const MAX_RESPONSE_BYTES = 1_048_576;

export interface MlClientLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
}

export interface HttpMlPredictionClientOptions {
  readonly baseUrl: URL;
  /** Solo se usa como cabecera X-Service-API-Key hacia Python; nunca se registra ni devuelve. */
  readonly serviceKey: string;
  readonly timeoutPolicy: MlTimeoutPolicy;
  readonly inferenceLimiter: ConcurrencyLimiter;
  readonly explanationLimiter: ConcurrencyLimiter;
  readonly circuitBreaker: CircuitBreaker;
  readonly batchMaxItems: number;
  readonly logger: MlClientLogger;
  readonly fetchImpl?: typeof fetch;
}

interface CallSpec<T> {
  readonly operation: MlOperation;
  readonly method: 'GET' | 'POST';
  /** Ruta de contrato fija: nunca se construye con datos del usuario. */
  readonly path: string;
  readonly body?: unknown;
  readonly authenticated: boolean;
  readonly validate: (data: unknown) => T;
  readonly logFields?: (result: T) => Record<string, unknown>;
}

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`ML HTTP ${status}`);
  }
}

export class HttpMlPredictionClient implements MlPredictionClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpMlPredictionClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  getModels(context: MlRequestContext): Promise<MlModelsResponse> {
    return this.call(
      {
        operation: 'models',
        method: 'GET',
        path: '/internal/v1/models',
        authenticated: true,
        validate: validateModelsResponse,
      },
      context,
    );
  }

  ready(context: MlRequestContext): Promise<MlReadyResponse> {
    return this.call(
      {
        operation: 'ready',
        method: 'GET',
        path: '/health/ready',
        authenticated: false,
        validate: validateReadyResponse,
      },
      context,
    );
  }

  predict(request: MlPredictionRequest, context: MlRequestContext): Promise<MlPredictionResponse> {
    return this.call(
      {
        operation: 'predict',
        method: 'POST',
        path: '/internal/v1/predictions',
        body: { ...contractBase(request), model_key: request.model_key },
        authenticated: true,
        validate: (data) => validatePredictionResponse(data, request.model_key),
        logFields: (result) => ({
          modelKey: result.model_key,
          modelHash: result.model_hash.slice(0, 12),
        }),
      },
      context,
    );
  }

  compare(request: MlCompareRequest, context: MlRequestContext): Promise<MlCompareResponse> {
    return this.call(
      {
        operation: 'compare',
        method: 'POST',
        path: '/internal/v1/predictions/compare',
        body: contractBase(request),
        authenticated: true,
        validate: (data) => validateCompareResponse(data),
        logFields: (result) => ({
          modelHashes: result.results.map((score) => score.model_hash.slice(0, 12)),
        }),
      },
      context,
    );
  }

  explain(
    request: MlExplanationRequest,
    context: MlRequestContext,
  ): Promise<MlExplanationResponse> {
    return this.call(
      {
        operation: 'explain',
        method: 'POST',
        path: '/internal/v1/predictions/explain',
        body: { ...contractBase(request), model_key: request.model_key, top_k: request.top_k },
        authenticated: true,
        validate: (data) =>
          validateExplanationResponse(data, { modelKey: request.model_key, topK: request.top_k }),
        logFields: (result) => ({
          modelKey: result.model_key,
          modelHash: result.model_hash.slice(0, 12),
          outputSpace: result.explanation.output_space,
        }),
      },
      context,
    );
  }

  getResearchPolicy(context: MlRequestContext): Promise<MlResearchPolicyCatalog> {
    return this.call(
      {
        operation: 'research_policy',
        method: 'GET',
        path: '/internal/v2/risk-policy',
        authenticated: true,
        validate: validateResearchPolicyCatalog,
        logFields: (result) => ({
          researchPolicyAvailable: result.available,
          researchPolicyReason: result.reason,
          policyHashes: result.policies.map((policy) => policy.policy_hash.slice(0, 12)),
        }),
      },
      context,
    );
  }

  predictResearch(
    request: MlResearchPredictionRequest,
    context: MlRequestContext,
  ): Promise<MlResearchPredictionResponse> {
    return this.call(
      {
        operation: 'research_predict',
        method: 'POST',
        path: '/internal/v2/predictions',
        body: { ...contractBase(request), model_key: request.model_key },
        authenticated: true,
        validate: (data) => validateResearchPredictionResponse(data, request.model_key),
        logFields: (result) => ({
          modelKey: result.model_key,
          modelHash: result.model_hash,
          policyHash: result.experimental_risk.policy_hash.slice(0, 12),
        }),
      },
      context,
    );
  }

  compareResearch(
    request: MlResearchCompareRequest,
    context: MlRequestContext,
  ): Promise<MlResearchCompareResponse> {
    return this.call(
      {
        operation: 'research_compare',
        method: 'POST',
        path: '/internal/v2/predictions/compare',
        body: contractBase(request),
        authenticated: true,
        validate: validateResearchCompareResponse,
        logFields: (result) => ({
          modelHashes: result.results.map((score) => score.model_hash),
          policyHashes: result.results.map((score) =>
            score.experimental_risk.policy_hash.slice(0, 12),
          ),
        }),
      },
      context,
    );
  }

  batch(request: MlBatchRequest, context: MlRequestContext): Promise<MlBatchResponse> {
    const itemCount = request.items.length;
    if (itemCount < 1 || itemCount > this.options.batchMaxItems) {
      return Promise.reject(
        new MlContractViolationException({
          operation: 'batch',
          code: 'ML_REQUEST_REJECTED',
          issuePaths: ['items'],
        }),
      );
    }

    const items = request.items.map((item) => ({ features: toCanonicalFeatures(item.features) }));
    return this.call(
      {
        operation: 'batch',
        method: 'POST',
        path: '/internal/v1/predictions/batch',
        body: {
          mode: request.mode,
          feature_version: request.feature_version,
          feature_context: contextOf(request.feature_context),
          items,
          ...(request.mode === 'single' ? { model_key: request.model_key } : {}),
        },
        authenticated: true,
        validate: (data) =>
          validateBatchResponse(data, {
            mode: request.mode,
            itemCount,
            ...(request.mode === 'single' ? { modelKey: request.model_key } : {}),
          }),
        logFields: (result) => ({ itemCount: result.count, mode: result.mode }),
      },
      context,
    );
  }

  private async call<T>(spec: CallSpec<T>, context: MlRequestContext): Promise<T> {
    const { circuitBreaker } = this.options;
    if (!circuitBreaker.tryAcquire()) {
      throw new MlUnavailableException({ code: 'ML_CIRCUIT_OPEN', operation: spec.operation });
    }

    const timeoutMs = this.options.timeoutPolicy.timeoutFor(spec.operation);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = context.signal
      ? AbortSignal.any([timeoutSignal, context.signal])
      : timeoutSignal;
    const limiter =
      spec.operation === 'explain'
        ? this.options.explanationLimiter
        : this.options.inferenceLimiter;
    const startedAt = performance.now();

    try {
      const result = await limiter.run(() => this.send(spec, context, signal), signal);
      circuitBreaker.recordSuccess();
      this.log('info', spec, context, startedAt, 200, spec.logFields?.(result));
      return result;
    } catch (error) {
      const mapped = this.mapFailure(error, spec.operation, timeoutMs, timeoutSignal);
      const status = error instanceof HttpFailure ? error.status : null;
      this.registerOutcome(mapped, status, context.signal?.aborted === true);
      this.log('warn', spec, context, startedAt, status, { errorCode: readCode(mapped) });
      throw mapped;
    }
  }

  private async send<T>(
    spec: CallSpec<T>,
    context: MlRequestContext,
    signal: AbortSignal,
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-request-id': context.requestId,
    };
    if (spec.authenticated) headers['x-service-api-key'] = this.options.serviceKey;
    if (spec.body !== undefined) headers['content-type'] = 'application/json';

    const response = await this.fetchImpl(new URL(spec.path, this.options.baseUrl), {
      method: spec.method,
      headers,
      ...(spec.body !== undefined ? { body: JSON.stringify(spec.body) } : {}),
      signal,
      redirect: 'error',
    });

    const body = await readJsonBody(response, spec.operation);

    if (response.status !== 200) {
      throw new HttpFailure(response.status, body);
    }

    return spec.validate(body);
  }

  private mapFailure(
    error: unknown,
    operation: MlOperation,
    timeoutMs: number,
    timeoutSignal: AbortSignal,
  ): Error {
    if (error instanceof HttpFailure) return mapMlHttpError(error.status, error.body, operation);
    if (error instanceof ConcurrencyLimitExceededError) {
      return new MlRateLimitedException({ operation, origin: 'LOCAL_BACKPRESSURE' });
    }
    if (timeoutSignal.aborted) return new MlTimeoutException({ operation, timeoutMs });
    if (error instanceof MlContractViolationException) return error;
    if (error instanceof Error && error.name === 'AbortError') {
      return new MlUnavailableException({ code: 'ML_UNAVAILABLE', operation });
    }
    return new MlUnavailableException({ code: 'ML_UNAVAILABLE', operation, cause: error });
  }

  private registerOutcome(error: Error, status: number | null, callerAborted: boolean): void {
    const { circuitBreaker } = this.options;

    if (callerAborted || (error instanceof MlRateLimitedException && status === null)) {
      // La llamada no llegó a evaluar la salud del servicio (cola local o cliente cancelado).
      circuitBreaker.releaseProbe();
    } else if (
      error instanceof MlRateLimitedException ||
      error instanceof MlResearchPolicyUnavailableException
    ) {
      // Saturación o política research no lista: los modelos siguen sanos (v1 operativo).
      circuitBreaker.recordNeutral();
    } else if (status !== null && !isServerSideFailure(status)) {
      circuitBreaker.recordNeutral();
    } else {
      circuitBreaker.recordFailure();
    }
  }

  private log(
    level: 'info' | 'warn',
    spec: Pick<CallSpec<unknown>, 'operation' | 'path'>,
    context: MlRequestContext,
    startedAt: number,
    status: number | null,
    extra: Record<string, unknown> | undefined,
  ): void {
    // Sin payloads de features, IDs de cliente, cabeceras ni clave de servicio.
    this.options.logger[level](
      {
        event: 'ml_request',
        requestId: context.requestId,
        operation: spec.operation,
        contractPath: spec.path,
        httpStatus: status,
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        circuitState: this.options.circuitBreaker.state,
        ...extra,
      },
      'ML request completed',
    );
  }
}

/**
 * Cuerpos construidos SOLO con campos del contrato: el servicio Python rechaza extras
 * (extra=forbid), y así ningún dato ajeno (IDs, target) puede filtrarse por un spread.
 */
function contextOf(
  context: MlCompareRequest['feature_context'],
): MlCompareRequest['feature_context'] {
  return { snapshot_type: context.snapshot_type, builder_version: context.builder_version };
}

function contractBase(request: MlCompareRequest): MlCompareRequest {
  return {
    feature_version: request.feature_version,
    feature_context: contextOf(request.feature_context),
    features: toCanonicalFeatures(request.features),
  };
}

function readCode(error: Error): string {
  const code: unknown = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : error.name;
}

async function readJsonBody(response: Response, operation: MlOperation): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();

  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new MlContractViolationException({ operation, issuePaths: ['(body-size)'] });
  }

  if (!contentType.toLowerCase().startsWith('application/json')) {
    if (response.status !== 200) return null;
    throw new MlContractViolationException({ operation, issuePaths: ['(content-type)'] });
  }

  try {
    // JSON.parse rechaza NaN/Infinity: un servidor que los emita queda fuera de contrato.
    return JSON.parse(text) as unknown;
  } catch {
    if (response.status !== 200) return null;
    throw new MlContractViolationException({ operation, issuePaths: ['(json)'] });
  }
}
