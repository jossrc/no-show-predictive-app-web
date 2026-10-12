import { z } from 'zod';

const nodeEnvironments = ['development', 'test', 'production'] as const;
const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const envBoolean = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'], {
      error: 'El valor debe ser true o false',
    })
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');

const optionalText = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  });

const postgresSchema = {
  DB_HOST_POSTGRES: z
    .string({
      error: 'DB_HOST_POSTGRES debe ser una cadena de texto',
    })
    .min(1, {
      error: 'DB_HOST_POSTGRES no puede estar vacío',
    }),

  DB_PORT_POSTGRES: z.coerce
    .number({ error: 'DB_PORT_POSTGRES debe ser un número' })
    .int({ error: 'DB_PORT_POSTGRES debe ser un número entero' })
    .min(1, { error: 'DB_PORT_POSTGRES debe ser como mínimo 1' })
    .max(65535, { error: 'DB_PORT_POSTGRES no puede ser mayor que 65535' })
    .default(5432),

  DB_USER_POSTGRES: z
    .string({
      error: 'DB_USER_POSTGRES debe ser una cadena de texto',
    })
    .min(1, {
      error: 'DB_USER_POSTGRES no puede estar vacío',
    }),

  DB_PASS_POSTGRES: z
    .string({
      error: 'DB_PASS_POSTGRES debe ser una cadena de texto',
    })
    .default(''),

  DB_NAME_POSTGRES: z
    .string({
      error: 'DB_NAME_POSTGRES debe ser una cadena de texto',
    })
    .min(1, {
      error: 'DB_NAME_POSTGRES no puede estar vacío',
    }),
};

const mysqlSchema = {
  DB_HOST_MYSQL: optionalText,
  DB_PORT_MYSQL: z.coerce
    .number({ error: 'DB_PORT_MYSQL debe ser un número' })
    .int({ error: 'DB_PORT_MYSQL debe ser un número entero' })
    .min(1, { error: 'DB_PORT_MYSQL debe ser como mínimo 1' })
    .max(65535, { error: 'DB_PORT_MYSQL no puede ser mayor que 65535' })
    .default(3306),
  DB_USER_MYSQL: optionalText,
  DB_PASS_MYSQL: z
    .string({
      error: 'DB_PASS_MYSQL debe ser una cadena de texto',
    })
    .optional()
    .default(''),
  DB_NAME_MYSQL: optionalText,
};

const poolSchema = {
  DATABASE_POOL_MAX: z.coerce
    .number()
    .int({
      error: 'DATABASE_POOL_MAX debe ser un número entero',
    })
    .positive({
      error: 'DATABASE_POOL_MAX debe ser un número positivo',
    })
    .default(10),

  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce
    .number()
    .int({
      error: 'DATABASE_CONNECTION_TIMEOUT_MS debe ser un número entero',
    })
    .positive({
      error: 'DATABASE_CONNECTION_TIMEOUT_MS debe ser un número positivo',
    })
    .default(5000),

  DATABASE_IDLE_TIMEOUT_MS: z.coerce
    .number()
    .int({
      error: 'DATABASE_IDLE_TIMEOUT_MS debe ser un número entero',
    })
    .positive({
      error: 'DATABASE_IDLE_TIMEOUT_MS debe ser un número positivo',
    })
    .default(30000),

  DATABASE_LOGGING: envBoolean(false),
};

const serverSchema = {
  NODE_ENV: z
    .enum(nodeEnvironments, {
      error: `NODE_ENV debe ser uno de: ${nodeEnvironments.join(', ')}`,
    })
    .default('development'),

  HOST: z.string({ error: 'HOST debe ser una cadena de texto' }).default('0.0.0.0'),

  PORT: z.coerce
    .number({ error: 'PORT debe ser un número' })
    .int({ error: 'PORT debe ser un número entero' })
    .min(1, { error: 'PORT debe ser como mínimo 1' })
    .max(65535, { error: 'PORT no puede ser mayor que 65535' })
    .default(3000),

  LOG_LEVEL: z
    .enum(logLevels, {
      error: `LOG_LEVEL debe ser uno de: ${logLevels.join(', ')}`,
    })
    .default('info'),
};

const positiveInt = (name: string, defaultValue: number, max: number) =>
  z.coerce
    .number({ error: `${name} debe ser un número` })
    .int({ error: `${name} debe ser un número entero` })
    .min(1, { error: `${name} debe ser como mínimo 1` })
    .max(max, { error: `${name} no puede ser mayor que ${max}` })
    .default(defaultValue);

const dataSourceModes = ['READ_ONLY_EXISTING_SCHEDULE', 'SYNTHETIC_DEMO_ONLY'] as const;

const predictiveApiSchema = {
  PREDICTIVE_API_ENABLED: envBoolean(true),

  INTERNAL_API_KEY_SHA256: optionalText.pipe(
    z
      .string()
      .regex(/^[0-9a-f]{64}$/, {
        error: 'INTERNAL_API_KEY_SHA256 debe ser un SHA-256 hexadecimal en minúsculas',
      })
      .optional(),
  ),

  DATA_SOURCE_MODE: z
    .enum(dataSourceModes, {
      error: `DATA_SOURCE_MODE debe ser uno de: ${dataSourceModes.join(', ')}`,
    })
    .default('READ_ONLY_EXISTING_SCHEDULE'),
};

const mlServiceSchema = {
  ML_SERVICE_URL: z
    .string({ error: 'ML_SERVICE_URL debe ser una cadena de texto' })
    .default('http://127.0.0.1:8001'),

  ML_SERVICE_KEY: optionalText.pipe(
    z
      .string()
      .min(32, { error: 'ML_SERVICE_KEY debe tener al menos 32 caracteres' })
      .max(512, { error: 'ML_SERVICE_KEY no puede superar 512 caracteres' })
      .regex(/^[\x21-\x7e]+$/, { error: 'ML_SERVICE_KEY debe ser ASCII imprimible sin espacios' })
      .optional(),
  ),

  ML_SERVICE_ALLOWED_HOSTS: optionalText,
  ML_HTTP_TIMEOUT_MS: positiveInt('ML_HTTP_TIMEOUT_MS', 5000, 120000),
  ML_EXPLAIN_TIMEOUT_MS: positiveInt('ML_EXPLAIN_TIMEOUT_MS', 10000, 120000),
  ML_MAX_CONCURRENT_REQUESTS: positiveInt('ML_MAX_CONCURRENT_REQUESTS', 2, 32),
  ML_MAX_CONCURRENT_EXPLANATIONS: positiveInt('ML_MAX_CONCURRENT_EXPLANATIONS', 1, 4),
  ML_MAX_QUEUED_REQUESTS: positiveInt('ML_MAX_QUEUED_REQUESTS', 8, 256),
  ML_BATCH_MAX_ITEMS: positiveInt('ML_BATCH_MAX_ITEMS', 32, 64),
  ML_CIRCUIT_FAILURE_THRESHOLD: positiveInt('ML_CIRCUIT_FAILURE_THRESHOLD', 5, 100),
  ML_CIRCUIT_COOLDOWN_MS: positiveInt('ML_CIRCUIT_COOLDOWN_MS', 30000, 600000),
  ML_MODEL_CATALOG_TTL_MS: positiveInt('ML_MODEL_CATALOG_TTL_MS', 60000, 3600000),
  /** Bandas experimentales v2 (research_risk_v1_1). true ⇒ POST exige política v2 disponible. */
  ML_RESEARCH_RISK_ENABLED: envBoolean(true),
  /** Allowlist opcional de hashes de política research aceptados (SHA-256 separados por coma). */
  ML_RESEARCH_EXPECTED_POLICY_HASHES: optionalText.pipe(
    z
      .string()
      .regex(/^[0-9a-f]{64}(,[0-9a-f]{64})*$/, {
        error:
          'ML_RESEARCH_EXPECTED_POLICY_HASHES debe ser una lista de SHA-256 separados por coma',
      })
      .optional(),
  ),
};

const predictiveStoreSchema = {
  /**
   * Archivo SQLite del almacén predictivo local. Por defecto `.local/predictive-store/<modo>.sqlite`
   * (ignorado por Git). `:memory:` solo para pruebas (no durable).
   */
  PREDICTIVE_STORE_SQLITE_PATH: optionalText,
};

export const EnvironmentSchema = z.object({
  ...postgresSchema,
  ...mysqlSchema,
  ...poolSchema,
  ...serverSchema,
  ...predictiveApiSchema,
  ...mlServiceSchema,
  ...predictiveStoreSchema,
});

export type EnvironmentVariables = z.infer<typeof EnvironmentSchema>;
