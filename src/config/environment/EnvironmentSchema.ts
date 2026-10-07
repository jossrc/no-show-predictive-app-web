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

export const EnvironmentSchema = z.object({
  ...postgresSchema,
  ...mysqlSchema,
  ...poolSchema,
  ...serverSchema,
});
