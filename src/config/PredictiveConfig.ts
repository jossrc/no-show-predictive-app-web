import type { EnvironmentVariables } from './environment/EnvironmentSchema.js';
import type { PredictiveAppDatabaseConfig } from '../infrastructure/database/postgres/PredictiveAppDatabase.js';
import type { DataSourceMode } from '../shared/data/DataSourceMode.js';
import { AUTH_LIMITATION_CODE } from '../shared/security/RequestPrincipal.js';
import {
  parseAllowedHosts,
  resolveMlServiceBaseUrl,
} from '../infrastructure/http/ml/MlServiceUrl.js';

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
  /** Bandas experimentales research v2 (ML_RESEARCH_RISK_ENABLED). */
  readonly researchRiskEnabled: boolean;
  readonly expectedResearchPolicyHashes: readonly string[];
}

export interface PredictiveStoreConfig {
  readonly driver: 'postgresql';
  /** Conexión del almacén propio (ml.app_*); null solo si las rutas de negocio no se registran. */
  readonly database: PredictiveAppDatabaseConfig | null;
  /** Rol superusuario/propietario tolerado (solo desarrollo local; nunca production). */
  readonly allowPrivilegedRole: boolean;
}

export interface ReservationImportConfig {
  readonly maxFileBytes: number;
  readonly maxRows: number;
}

export interface PredictiveConfig {
  readonly api: PredictiveApiConfig;
  readonly dataSourceMode: DataSourceMode;
  readonly ml: MlServiceConfig;
  readonly store: PredictiveStoreConfig;
  readonly sourceStatementTimeoutMs: number;
  readonly reservationImport: ReservationImportConfig;
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

/**
 * SYNTHETIC_DEMO_ONLY obtiene reservas, evidencia e historial EXCLUSIVAMENTE del dataset
 * sintético versionado (sin lecturas de negocio a la fuente PostgreSQL) y persiste en un almacén
 * PostgreSQL ligado a ese modo (otra base). Prohibido en production.
 */
function resolveDataSourceMode(env: EnvironmentVariables): DataSourceMode {
  if (env.DATA_SOURCE_MODE === 'SYNTHETIC_DEMO_ONLY' && env.NODE_ENV === 'production') {
    throw new Error('DATA_SOURCE_MODE=SYNTHETIC_DEMO_ONLY no está permitido en production');
  }
  return env.DATA_SOURCE_MODE;
}

/**
 * Almacén predictivo PostgreSQL de la app (ADR-008). Con rutas de negocio habilitadas las
 * credenciales APP_DB_* son obligatorias (fallo al arrancar, sin fallback a SQLite ni memoria) y
 * el rol debe ser distinto del de la fuente de solo lectura salvo excepción local explícita.
 */
function resolveStoreConfig(
  env: EnvironmentVariables,
  api: PredictiveApiConfig,
): PredictiveStoreConfig {
  const allowPrivilegedRole = env.APP_DB_ALLOW_PRIVILEGED_ROLE;
  if (allowPrivilegedRole && env.NODE_ENV === 'production') {
    throw new Error('APP_DB_ALLOW_PRIVILEGED_ROLE=true no está permitido en production');
  }
  if (!api.enabled) return { driver: 'postgresql', database: null, allowPrivilegedRole };
  return { driver: 'postgresql', allowPrivilegedRole, database: resolveAppDatabaseConfig(env) };
}

/**
 * Conexión del almacén de la app desde APP_DB_* (también para las CLIs store:*). Lanza si faltan
 * credenciales o si el rol coincide con el de la fuente de solo lectura sin excepción explícita.
 */
export function resolveAppDatabaseConfig(env: EnvironmentVariables): PredictiveAppDatabaseConfig {
  const missing = (
    [
      ['APP_DB_HOST_POSTGRES', env.APP_DB_HOST_POSTGRES],
      ['APP_DB_NAME_POSTGRES', env.APP_DB_NAME_POSTGRES],
      ['APP_DB_USER_POSTGRES', env.APP_DB_USER_POSTGRES],
    ] as const
  )
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Almacén predictivo PostgreSQL sin configurar: ${missing.join(', ')}`);
  }
  if (env.APP_DB_USER_POSTGRES === env.DB_USER_POSTGRES && !env.APP_DB_ALLOW_PRIVILEGED_ROLE) {
    throw new Error(
      'APP_DB_USER_POSTGRES debe ser un rol distinto del de la fuente de solo lectura (DB_USER_POSTGRES)',
    );
  }

  return {
    host: env.APP_DB_HOST_POSTGRES as string,
    port: env.APP_DB_PORT_POSTGRES,
    database: env.APP_DB_NAME_POSTGRES as string,
    user: env.APP_DB_USER_POSTGRES as string,
    password: env.APP_DB_PASS_POSTGRES,
    poolMax: env.DATABASE_POOL_MAX,
    connectionTimeoutMs: env.DATABASE_CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: env.DATABASE_IDLE_TIMEOUT_MS,
    statementTimeoutMs: env.APP_DB_STATEMENT_TIMEOUT_MS,
  };
}

export function createPredictiveConfig(env: EnvironmentVariables): PredictiveConfig {
  const dataSourceMode = resolveDataSourceMode(env);
  const api = resolveApiConfig(env);
  return {
    api,
    dataSourceMode,
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
      researchRiskEnabled: env.ML_RESEARCH_RISK_ENABLED,
      expectedResearchPolicyHashes: env.ML_RESEARCH_EXPECTED_POLICY_HASHES?.split(',') ?? [],
    },
    store: resolveStoreConfig(env, api),
    sourceStatementTimeoutMs: 10_000,
    reservationImport: {
      maxFileBytes: env.RESERVATION_IMPORT_MAX_FILE_BYTES,
      maxRows: env.RESERVATION_IMPORT_MAX_ROWS,
    },
  };
}
