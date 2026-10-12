import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { HttpMlPredictionClient } from '../../../../../src/infrastructure/http/ml/HttpMlPredictionClient.js';
import type { MlCompareRequest } from '../../../../../src/infrastructure/http/ml/MlContractTypes.js';
import { PREDICTOR_COLUMNS } from '../../../../../src/infrastructure/http/ml/MlFeatureContract.js';
import { MlTimeoutPolicy } from '../../../../../src/infrastructure/http/ml/MlTimeoutPolicy.js';
import { MlContractViolationException } from '../../../../../src/infrastructure/http/ml/errors/MlContractViolationException.js';
import { MlInvalidFeaturesException } from '../../../../../src/infrastructure/http/ml/errors/MlInvalidFeaturesException.js';
import { MlRateLimitedException } from '../../../../../src/infrastructure/http/ml/errors/MlRateLimitedException.js';
import { MlResearchPolicyUnavailableException } from '../../../../../src/infrastructure/http/ml/errors/MlResearchPolicyUnavailableException.js';
import { MlTimeoutException } from '../../../../../src/infrastructure/http/ml/errors/MlTimeoutException.js';
import { MlUnavailableException } from '../../../../../src/infrastructure/http/ml/errors/MlUnavailableException.js';
import { CircuitBreaker } from '../../../../../src/infrastructure/resilience/CircuitBreaker.js';
import { ConcurrencyLimiter } from '../../../../../src/infrastructure/resilience/ConcurrencyLimiter.js';
import { loadJsonFixture, loadMlGolden } from '../../../../helpers/LoadFixture.js';

const SERVICE_KEY = 'svc-key-for-tests-only-0123456789abcdefghij';

interface Captured {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage['headers'];
  body: string;
}

let server: Server;
let baseUrl: URL;
let handler: (request: Captured, response: ServerResponse) => void;
const received: Captured[] = [];

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const request: MlCompareRequest = {
  feature_version: 'BOOKING_BASELINE_V1',
  feature_context: {
    snapshot_type: 'booking_creation',
    builder_version: 'risk_features_builder_v1',
  },
  features: loadJsonFixture<{ request: MlCompareRequest }>(
    'fixtures/ml/synthetic_compare_request.json',
  ).request.features,
};

function makeClient(
  overrides: { breaker?: CircuitBreaker; timeoutMs?: number; logs?: string[] } = {},
) {
  const logs = overrides.logs ?? [];
  return new HttpMlPredictionClient({
    baseUrl,
    serviceKey: SERVICE_KEY,
    timeoutPolicy: new MlTimeoutPolicy({
      defaultMs: overrides.timeoutMs ?? 2000,
      explanationMs: 2000,
    }),
    inferenceLimiter: new ConcurrencyLimiter(4, 4),
    explanationLimiter: new ConcurrencyLimiter(1, 2),
    circuitBreaker:
      overrides.breaker ?? new CircuitBreaker({ failureThreshold: 50, cooldownMs: 1000 }),
    batchMaxItems: 32,
    logger: {
      info: (payload, message) => void logs.push(JSON.stringify({ payload, message })),
      warn: (payload, message) => void logs.push(JSON.stringify({ payload, message })),
    },
  });
}

before(async () => {
  server = createServer((incoming, response) => {
    let body = '';
    incoming.on('data', (chunk) => (body += chunk));
    incoming.on('end', () => {
      const captured = {
        method: incoming.method,
        url: incoming.url,
        headers: incoming.headers,
        body,
      };
      received.push(captured);
      handler(captured, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  received.length = 0;
});

describe('HttpMlPredictionClient v2 research (servidor HTTP mock loopback)', () => {
  it('rutas exactas v2, clave solo en X-Service-API-Key, cuerpo con 19 claves canónicas', async () => {
    handler = (req, res) => {
      if (req.url === '/internal/v2/risk-policy')
        return json(res, 200, loadMlGolden('golden_v2_risk_policy'));
      if (req.url === '/internal/v2/predictions')
        return json(res, 200, loadMlGolden('golden_v2_predict_xgb'));
      if (req.url === '/internal/v2/predictions/compare')
        return json(res, 200, loadMlGolden('golden_v2_compare'));
      json(res, 404, {});
    };
    const client = makeClient();
    const catalog = await client.getResearchPolicy({ requestId: 'rq-policy' });
    const single = await client.predictResearch(
      { ...request, model_key: 'xgboost_full_v1' },
      { requestId: 'rq-single' },
    );
    const compared = await client.compareResearch(request, { requestId: 'rq-compare' });

    assert.equal(catalog.available, true);
    assert.equal(single.experimental_risk.level, 'HIGH');
    assert.deepEqual(
      compared.results.map((r) => r.experimental_risk.level),
      ['HIGH', 'HIGH'],
    );
    assert.deepEqual(
      received.map((r) => `${r.method} ${r.url}`),
      [
        'GET /internal/v2/risk-policy',
        'POST /internal/v2/predictions',
        'POST /internal/v2/predictions/compare',
      ],
    );
    for (const call of received) {
      assert.equal(call.headers['x-service-api-key'], SERVICE_KEY);
      assert.match(String(call.headers['x-request-id']), /^rq-/);
    }
    const singleBody = JSON.parse(received[1]!.body);
    assert.equal(singleBody.model_key, 'xgboost_full_v1');
    assert.deepEqual(Object.keys(singleBody.features), [...PREDICTOR_COLUMNS]);
    const compareBody = JSON.parse(received[2]!.body);
    assert.deepEqual(Object.keys(compareBody).sort(), [
      'feature_context',
      'feature_version',
      'features',
    ]);
  });

  it('503 RESEARCH_RISK_POLICY_NOT_READY ⇒ excepción tipada 503 con razón, circuito intacto', async () => {
    handler = (_req, res) => json(res, 503, loadMlGolden('golden_v2_error_503_policy'));
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 });
    const client = makeClient({ breaker });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await assert.rejects(
        () => client.compareResearch(request, { requestId: `rq-${attempt}` }),
        (error: unknown) =>
          error instanceof MlResearchPolicyUnavailableException &&
          error.code === 'RESEARCH_RISK_POLICY_NOT_READY' &&
          error.reason === 'disabled' &&
          JSON.stringify(error.details) === '{"field":"experimental_risk","reason":"disabled"}',
      );
    }
    assert.equal(received.length, 3, 'la política no lista no abre el circuito de inferencia v1');
    assert.equal(breaker.state, 'CLOSED');
  });

  it('catálogo UNAVAILABLE (200) se devuelve tal cual: nunca se interpreta como LOW', async () => {
    handler = (_req, res) => json(res, 200, loadMlGolden('golden_v2_risk_policy_unavailable'));
    const catalog = await makeClient().getResearchPolicy({ requestId: 'rq' });
    assert.deepEqual(
      [catalog.available, catalog.status, catalog.reason],
      [false, 'UNAVAILABLE', 'disabled'],
    );
  });

  it('401/422/429/503 genérico y 500 se mapean a errores estables', async () => {
    const cases: Array<[number, unknown, (e: unknown) => boolean]> = [
      [
        401,
        loadMlGolden('golden_error_401'),
        (e) => e instanceof MlUnavailableException && e.code === 'ML_CREDENTIAL_REJECTED',
      ],
      [
        422,
        {
          error: {
            code: 'INVALID_FEATURES',
            message: 'x',
            details: [{ field: 'features.clinic_id', reason: 'greater_than' }],
          },
          request_id: 'r',
        },
        (e) => e instanceof MlInvalidFeaturesException,
      ],
      [
        429,
        { error: { code: 'TOO_MANY_REQUESTS', message: 'x', details: [] }, request_id: 'r' },
        (e) => e instanceof MlRateLimitedException,
      ],
      [
        503,
        { error: { code: 'MODEL_NOT_READY', message: 'x', details: [] }, request_id: 'r' },
        (e) => e instanceof MlUnavailableException && e.code === 'ML_UNAVAILABLE',
      ],
      [
        500,
        { error: { code: 'INFERENCE_FAILED', message: 'x', details: [] }, request_id: 'r' },
        (e) => e instanceof MlUnavailableException && e.code === 'ML_INFERENCE_FAILED',
      ],
    ];
    for (const [status, body, matches] of cases) {
      handler = (_req, res) => json(res, status, body);
      await assert.rejects(
        () =>
          makeClient().predictResearch(
            { ...request, model_key: 'random_forest_full_v1' },
            { requestId: 'rq' },
          ),
        matches,
      );
    }
  });

  it('200 alterado (nivel incoherente) ⇒ ML_CONTRACT_VIOLATION sin devolver datos', async () => {
    const tampered = loadMlGolden<Record<string, any>>('golden_v2_predict_rf');
    tampered.experimental_risk.level = 'LOW';
    tampered.experimental_risk.label = 'Bajo (exploratorio)';
    handler = (_req, res) => json(res, 200, tampered);
    await assert.rejects(
      () =>
        makeClient().predictResearch(
          { ...request, model_key: 'random_forest_full_v1' },
          { requestId: 'rq' },
        ),
      MlContractViolationException,
    );
  });

  it('timeout ⇒ ML_TIMEOUT con una sola petición (sin reintento)', async () => {
    handler = () => undefined;
    await assert.rejects(
      () => makeClient({ timeoutMs: 50 }).compareResearch(request, { requestId: 'rq' }),
      MlTimeoutException,
    );
    assert.equal(received.length, 1);
  });

  it('logs sin clave ni features: solo identidad abreviada de modelo/política', async () => {
    handler = (_req, res) => json(res, 200, loadMlGolden('golden_v2_compare'));
    const logs: string[] = [];
    await makeClient({ logs }).compareResearch(request, { requestId: 'rq-log' });
    const line = logs.join('\n');
    assert.ok(!line.includes(SERVICE_KEY));
    assert.ok(!line.includes('age_at_booking'));
    assert.match(line, /"policyHashes":\["1d58ce962e89","208c706d839b"\]/);
  });
});
