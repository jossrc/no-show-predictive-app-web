import type { EnvironmentVariables } from './environment/EnvironmentSchema.js';
import type { DataSourceMode } from '../shared/data/DataSourceMode.js';
import { AUTH_LIMITATION_CODE } from '../shared/security/RequestPrincipal.js';
import {
  parseAllowedHosts,
  resolveMlServiceBaseUrl,
} from '../infrastructure/http/ml/MlServiceUrl.js';

const SYNTHETIC_DATABASE_NAME = /(^|[_-])(test|synthetic|demo)([_-]|$)/i;

export interface PredictiveApiConfig {
  readonly enabled: boolean;
  readonly internalApiKeySha256: string | null;
  /** Motivo por el que las rutas de negocio no se registran (null si se registran). */
  readonly disabledReason: string | null;
}

export interface MlServiceConfig {
  readonly baseUrl: URL;
  readonly serviceKey: string | null;
  readonly defaultTimeoutMs: number;
  readonly explanationTimeoutMs: number;
  readonly maxConcurrentRequests: number;
  readonly maxConcurrentExplanations: number;
  readonly maxQueuedRequests: number;
  readonly batchMaxItems: number;
  readonly circuitFailureThreshold: number;
  readonly circuitCooldownMs: number;
  readonly modelCatalogTtlMs: number;
}

export interface PredictiveConfig {
  readonly api: PredictiveApiConfig;
  readonly dataSourceMode: DataSourceMode;
  readonly ml: MlServiceConfig;
  readonly sourceStatementTimeoutMs: number;
}

function resolveApiConfig(env: EnvironmentVariables): PredictiveApiConfig {
  if (!env.PREDICTIVE_API_ENABLED) {
    return {
      enabled: false,
      internalApiKeySha256: null,
      disabledReason: 'PREDICTIVE_API_ENABLED=false',
    };
  }

  if (env.NODE_ENV === 'production') {
    // La compuerta provisional no es un mecanismo de autenticación autorizado para producción.
    throw new Error(
      `Rutas de negocio rechazadas en production (${AUTH_LIMITATION_CODE}). ` +
        'Use PREDICTIVE_API_ENABLED=false hasta implementar HU-21/HU-22.',
    );
  }

  if (!env.INTERNAL_API_KEY_SHA256) {
    return {
      enabled: false,
      internalApiKeySha256: null,
      disabledReason: 'INTERNAL_API_KEY_SHA256 no configurada',
    };
  }

  return { enabled: true, internalApiKeySha256: env.INTERNAL_API_KEY_SHA256, disabledReason: null };
}

function resolveDataSourceMode(env: EnvironmentVariables): DataSourceMode {
  if (env.DATA_SOURCE_MODE !== 'SYNTHETIC_DEMO_ONLY') return env.DATA_SOURCE_MODE;

  if (env.NODE_ENV === 'production') {
    throw new Error('DATA_SOURCE_MODE=SYNTHETIC_DEMO_ONLY no está permitido en production');
  }
  if (!SYNTHETIC_DATABASE_NAME.test(env.DB_NAME_POSTGRES)) {
    throw new Error(
      'DATA_SOURCE_MODE=SYNTHETIC_DEMO_ONLY exige una base de prueba aislada (nombre con test/synthetic/demo)',
    );
  }
  return env.DATA_SOURCE_MODE;
}

export function createPredictiveConfig(env: EnvironmentVariables): PredictiveConfig {
  return {
    api: resolveApiConfig(env),
    dataSourceMode: resolveDataSourceMode(env),
    ml: {
      baseUrl: resolveMlServiceBaseUrl(env.ML_SERVICE_URL, {
        nodeEnv: env.NODE_ENV,
        allowedHosts: parseAllowedHosts(env.ML_SERVICE_ALLOWED_HOSTS),
      }),
      serviceKey: env.ML_SERVICE_KEY ?? null,
      defaultTimeoutMs: env.ML_HTTP_TIMEOUT_MS,
      explanationTimeoutMs: env.ML_EXPLAIN_TIMEOUT_MS,
      maxConcurrentRequests: env.ML_MAX_CONCURRENT_REQUESTS,
      maxConcurrentExplanations: env.ML_MAX_CONCURRENT_EXPLANATIONS,
      maxQueuedRequests: env.ML_MAX_QUEUED_REQUESTS,
      batchMaxItems: env.ML_BATCH_MAX_ITEMS,
      circuitFailureThreshold: env.ML_CIRCUIT_FAILURE_THRESHOLD,
      circuitCooldownMs: env.ML_CIRCUIT_COOLDOWN_MS,
      modelCatalogTtlMs: env.ML_MODEL_CATALOG_TTL_MS,
    },
    sourceStatementTimeoutMs: 10_000,
  };
}
