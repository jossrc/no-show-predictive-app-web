/**
 * Se carga con --import ANTES que cualquier módulo de src. Fija TODAS las variables del esquema
 * para que el .env local (con la BD real) nunca se use en pruebas: process.loadEnvFile no
 * sobrescribe variables ya definidas.
 * La única BD admitida es la de prueba aislada (docker-compose.test.yml, puerto 55432).
 */
const testDatabase = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: process.env.TEST_DB_PORT ?? '55432',
  user: process.env.TEST_DB_USER ?? 'test_admin',
  password: process.env.TEST_DB_PASS ?? 'test_only_not_a_secret',
  name: process.env.TEST_DB_NAME ?? 'depi_noshow_test',
};

if (!/(^|[_-])test([_-]|$)/i.test(testDatabase.name)) {
  throw new Error('TEST_DB_NAME debe identificar una base de PRUEBA (contener "test")');
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  HOST: '127.0.0.1',
  PORT: '3999',
  DB_HOST_POSTGRES: testDatabase.host,
  DB_PORT_POSTGRES: testDatabase.port,
  DB_USER_POSTGRES: testDatabase.user,
  DB_PASS_POSTGRES: testDatabase.password,
  DB_NAME_POSTGRES: testDatabase.name,
  DB_HOST_MYSQL: '',
  DB_PORT_MYSQL: '3306',
  DB_USER_MYSQL: '',
  DB_PASS_MYSQL: '',
  DB_NAME_MYSQL: '',
  DATABASE_POOL_MAX: '5',
  DATABASE_CONNECTION_TIMEOUT_MS: '2000',
  DATABASE_IDLE_TIMEOUT_MS: '1000',
  DATABASE_LOGGING: 'false',
  PREDICTIVE_API_ENABLED: 'true',
  INTERNAL_API_KEY_SHA256: '',
  DATA_SOURCE_MODE: 'READ_ONLY_EXISTING_SCHEDULE',
  ML_SERVICE_URL: 'http://127.0.0.1:8001',
  ML_SERVICE_KEY: '',
  ML_SERVICE_ALLOWED_HOSTS: '',
  ML_HTTP_TIMEOUT_MS: '5000',
  ML_EXPLAIN_TIMEOUT_MS: '10000',
  ML_MAX_CONCURRENT_REQUESTS: '2',
  ML_MAX_CONCURRENT_EXPLANATIONS: '1',
  ML_MAX_QUEUED_REQUESTS: '8',
  ML_BATCH_MAX_ITEMS: '32',
  ML_CIRCUIT_FAILURE_THRESHOLD: '5',
  ML_CIRCUIT_COOLDOWN_MS: '30000',
  ML_MODEL_CATALOG_TTL_MS: '60000',
});

export {};
